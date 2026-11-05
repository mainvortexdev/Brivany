import Foundation
import AVFoundation

/// Converter stays on the render callback. AVAudioEngine reuses tap buffers;
/// only owned Data crosses to MainActor. The ratio is derived from actual input.
final class BrivanyCaptureConverter: @unchecked Sendable {
    private let converter: AVAudioConverter
    private let format: AVAudioFormat
    private let lock = NSLock()
    private var framer = BrivanyPCMFramer()
    private var muted = false
    init(input: AVAudioFormat) throws {
        guard let output = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000, channels: 1, interleaved: true), let converter = AVAudioConverter(from: input, to: output) else { throw BrivanyLiveError.message("No se pudo preparar el micrófono.") }
        self.converter = converter; format = output
    }
    func setMuted(_ value: Bool) { lock.lock(); muted = value; framer.reset(); lock.unlock() }
    func convert(_ input: AVAudioPCMBuffer) throws -> [(Data, Double)] {
        lock.lock(); defer { lock.unlock() }
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 24000 / input.format.sampleRate) + 64)
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { throw BrivanyLiveError.message("No se pudo convertir la voz.") }
        var supplied = false; var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, state in
            if supplied { state.pointee = .noDataNow; return nil }; supplied = true; state.pointee = .haveData; return input
        }
        guard status != .error, error == nil else { throw BrivanyLiveError.message("El micrófono cambió de formato.") }
        guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return [] }
        let raw = Data(bytes: samples, count: Int(output.frameLength) * 2)
        return framer.append(raw).map { frame in
            var sum = 0.0
            frame.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in for i in stride(from: 0, to: bytes.count, by: 2) { let value = Double(Int16(bitPattern: UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8)) / 32768; sum += value * value } }
            return (muted ? Data(repeating: 0, count: 3840) : frame, muted ? 0 : min(1, sqrt(sum / 1920) * 5))
        }
    }
}

@MainActor final class BrivanyLiveAudio: BrivanyLiveAudioIO {
    var onPCM: ((Data, Double) -> Void)?
    var onFailure: ((String) -> Void)?
    var onOutputLevel: ((Double) -> Void)?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var capture: BrivanyCaptureConverter?
    private var active = false
    private var tapInstalled = false
    private var outputTapInstalled = false
    private var observers: [NSObjectProtocol] = []
    private var playbackID = UUID()
    private var pendingFrames = 0
    private var ended = false
    private var completion: CheckedContinuation<Void, Error>?
    private var ownsSession = false
    init() { engine.attach(player) }
    func start() async throws {
        guard !active else { return }
        let allowed = await withCheckedContinuation { continuation in AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) } }
        try Task.checkCancellation(); guard allowed else { throw BrivanyLiveError.message("Permite el micrófono en Ajustes para hablar con Melodi.") }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setPreferredIOBufferDuration(.02); try session.setActive(true); ownsSession = true
            let input = engine.inputNode; try input.setVoiceProcessingEnabled(true)
            let inputFormat = input.outputFormat(forBus: 0)
            guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else { throw BrivanyLiveError.message("No hay un micrófono disponible.") }
            let converter = try BrivanyCaptureConverter(input: inputFormat); capture = converter
            input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
                do {
                    let frames = try converter.convert(buffer)
                    for (raw, level) in frames { Task { @MainActor in guard let self, self.active else { return }; self.onPCM?(raw, level) } }
                } catch { Task { @MainActor in self?.onFailure?("No se pudo convertir el audio del micrófono.") } }
            }; tapInstalled = true
            guard let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1) else { throw BrivanyLiveError.message("No se pudo preparar la salida de voz.") }
            engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
            engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buffer, _ in
                guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }; var energy = 0.0
                for i in 0..<Int(buffer.frameLength) { energy += Double(samples[i] * samples[i]) }
                let level = min(1, sqrt(energy / Double(buffer.frameLength)) * 4)
                Task { @MainActor in guard let self, self.active else { return }; self.onOutputLevel?(level) }
            }; outputTapInstalled = true
            engine.prepare(); try engine.start(); active = true; installObservers()
        } catch { close(); throw error }
    }
    private func installObservers() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            if (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue { Task { @MainActor in self?.onFailure?("El audio se interrumpió. Vuelve a iniciar cuando puedas continuar.") } }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
                  [AVAudioSession.RouteChangeReason.newDeviceAvailable, .oldDeviceUnavailable, .noSuitableRouteForCategory].contains(reason) else { return }
            Task { @MainActor in self?.onFailure?("Cambió el micrófono o los audífonos. Vuelve a iniciar la conversación.") }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.onFailure?("iOS reinició el audio. Vuelve a iniciar.") } })
    }
    func setMuted(_ value: Bool) { capture?.setMuted(value) }
    func play(_ chunks: AsyncThrowingStream<Data, Error>, onStarted: @escaping () -> Void) async throws {
        guard active, engine.isRunning else { throw BrivanyLiveError.message("La salida de voz está desconectada.") }
        interrupt(); let identifier = UUID(); playbackID = identifier; ended = false
        var decoder = BrivanyPCMDecoder(); var started = false; var total = 0
        try await withTaskCancellationHandler(operation: {
            for try await chunk in chunks {
                try Task.checkCancellation(); guard playbackID == identifier else { throw CancellationError() }
                total += chunk.count; guard total <= 12_000_000 else { throw BrivanyLiveError.message("La respuesta de voz excedió su límite.") }
                let samples = try decoder.append(chunk)
                // Bound hardware lead to 400 ms; do not drop decoded speech.
                while pendingFrames > 9600 { try await Task.sleep(for: .milliseconds(15)); try Task.checkCancellation(); guard playbackID == identifier else { throw CancellationError() } }
                if !samples.isEmpty { try schedule(samples, identifier: identifier); if !started { started = true; player.play(); onStarted() } }
            }
            _ = try decoder.append(Data(), final: true); guard started else { throw BrivanyLiveError.message("No se recibió voz de Melodi.") }
            ended = true
            if pendingFrames > 0 { try await withCheckedThrowingContinuation { completion = $0 } }
        }, onCancel: { [weak self] in Task { @MainActor in if self?.playbackID == identifier { self?.interrupt() } } })
    }
    private func schedule(_ samples: [Float], identifier: UUID) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1), let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)), let target = buffer.floatChannelData?[0] else { throw BrivanyLiveError.message("No se pudo preparar la voz.") }
        buffer.frameLength = AVAudioFrameCount(samples.count); for (index, sample) in samples.enumerated() { target[index] = sample }; pendingFrames += samples.count
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in Task { @MainActor in
            guard let self, self.playbackID == identifier else { return }; self.pendingFrames = max(0, self.pendingFrames - samples.count)
            if self.ended && self.pendingFrames == 0 { let done = self.completion; self.completion = nil; self.onOutputLevel?(0); done?.resume() }
        } }
    }
    func interrupt() { playbackID = UUID(); player.stop(); pendingFrames = 0; ended = false; let done = completion; completion = nil; done?.resume(throwing: CancellationError()); onOutputLevel?(0) }
    func close() {
        active = false; interrupt(); engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }; if outputTapInstalled { engine.mainMixerNode.removeTap(onBus: 0); outputTapInstalled = false }
        engine.disconnectNodeOutput(player); capture = nil; observers.forEach(NotificationCenter.default.removeObserver); observers = []
        if ownsSession { ownsSession = false; try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
}
