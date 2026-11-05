import Foundation
import Combine

@MainActor final class BrivanyLiveSession: ObservableObject {
    @Published private(set) var state: BrivanyLiveState = .stopped
    @Published private(set) var stateText = "Hablar con Melodi"
    @Published private(set) var transcript = ""
    @Published private(set) var reply = ""
    @Published private(set) var inputLevel = 0.0
    @Published private(set) var outputLevel = 0.0
    @Published private(set) var isMuted = false
    private let audio: BrivanyLiveAudioIO
    private let transport: BrivanyLiveTransportIO
    private var lifecycle: Task<Void, Never>?
    private var response: Task<Void, Never>?
    private var sender: Task<Void, Never>?
    private var generation = UUID()
    private var responseID = UUID()
    private var running = false
    private var pcm: [Data] = []
    @Published private(set) var messages: [BrivanyLiveMessage] = []
    init(configuration: MobileConfiguration) { audio = BrivanyLiveAudio(); transport = BrivanyLiveTransport(configuration: configuration); bind() }
    init(audio: BrivanyLiveAudioIO, transport: BrivanyLiveTransportIO) { self.audio = audio; self.transport = transport; bind() }
    private func bind() {
        audio.onPCM = { [weak self] raw, level in self?.capture(raw, level: level) }
        audio.onOutputLevel = { [weak self] level in self?.outputLevel = level }
        audio.onFailure = { [weak self] text in self?.fail(text) }
    }
    private func set(_ value: BrivanyLiveState, _ text: String) { state = value; stateText = text }
    func start() {
        guard !running, lifecycle == nil else { return }; stop(); running = true; let id = UUID(); generation = id
        set(.connecting, "Conectando…")
        lifecycle = Task { [weak self] in
            guard let self else { return }
            defer { if generation == id { lifecycle = nil } }
            do {
                try await transport.connect(onEvent: { [weak self] event in guard let self, self.generation == id else { return }; self.receive(event) }, onFailure: { [weak self] text in guard let self, self.generation == id else { return }; self.fail(text) })
                try Task.checkCancellation(); guard generation == id else { return }; try await audio.start(); try Task.checkCancellation(); guard generation == id else { return }; audio.setMuted(isMuted)
                set(isMuted ? .muted : .listening, isMuted ? "Micrófono apagado" : "Te escucho")
            } catch { if generation == id && !Task.isCancelled { fail(error.localizedDescription) } }
        }
    }
    private func capture(_ raw: Data, level: Double) {
        guard running, raw.count == 3840 else { return }; inputLevel = isMuted ? 0 : level
        guard pcm.count < 25 else { fail("La conexión no envía la voz a tiempo. Vuelve a iniciar."); return }; pcm.append(raw)
        guard sender == nil else { return }; let id = generation
        sender = Task { [weak self] in
            guard let self else { return }; defer { if generation == id { sender = nil } }
            do { while generation == id && running && !pcm.isEmpty { try Task.checkCancellation(); let raw = pcm.removeFirst(); try await transport.send(raw) } }
            catch { if generation == id && !Task.isCancelled { fail("Se interrumpió el envío de voz.") } }
        }
    }
    private func receive(_ event: BrivanyASREvent) {
        guard running else { return }
        switch event {
        case .ready: break
        case .speechStart: if !isMuted { transcript = "" }
        case .transcript(_, let text, let final):
            guard !isMuted else { return }; transcript = text
            // Confirmed recognized words interrupt Melodi. Voice-processing AEC
            // remains active; energy alone cannot mistake music for a command.
            if text.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 && (state == .speaking || state == .thinking) { cancelResponse(); set(.listening, "Te escucho") }
            if final { let value = text.trimmingCharacters(in: .whitespacesAndNewlines); if !value.isEmpty { answer(value) } }
        }
    }
    private func cancelResponse() { responseID = UUID(); response?.cancel(); response = nil; audio.interrupt(); outputLevel = 0 }
    private func answer(_ text: String) {
        cancelResponse(); let id = UUID(); responseID = id; reply = ""; messages.append(.init(role: "user", content: text)); messages = Array(messages.suffix(24)); set(.thinking, "Pensando…")
        let history = messages
        response = Task { [weak self] in
            guard let self else { return }
            let (phrases, queue) = AsyncThrowingStream<String, Error>.makeStream()
            let playback = Task { @MainActor in
                for try await phrase in phrases { try Task.checkCancellation(); guard responseID == id else { throw CancellationError() }; let stream = try await transport.speech(phrase); try await audio.play(stream, onStarted: { [weak self] in guard let self, self.responseID == id else { return }; self.set(.speaking, "Melodi") }) }
            }
            do {
                var splitter = BrivanySpeechPhrases(); let stream = try await transport.chat(history)
                for try await delta in stream { try Task.checkCancellation(); guard responseID == id else { throw CancellationError() }; reply += delta; for phrase in splitter.append(delta) { queue.yield(phrase) } }
                for phrase in splitter.append("", final: true) { queue.yield(phrase) }; queue.finish(); try await playback.value
                guard responseID == id, running else { return }; if !reply.isEmpty { messages.append(.init(role: "assistant", content: reply)) }; response = nil; set(isMuted ? .muted : .listening, isMuted ? "Micrófono apagado" : "Te escucho")
            } catch {
                queue.finish(throwing: error); playback.cancel(); if responseID == id && !Task.isCancelled { fail("La respuesta de Melodi se interrumpió. Puedes volver a iniciar.") }
            }
        }
    }
    func toggleMute() { isMuted.toggle(); pcm.removeAll(); audio.setMuted(isMuted); inputLevel = 0; if isMuted { transcript = "" }; if state == .listening || state == .muted { set(isMuted ? .muted : .listening, isMuted ? "Micrófono apagado" : "Te escucho") } }
    func send(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard running, !clean.isEmpty, clean.utf16.count <= 2400 else { return }
        transcript = clean; answer(clean)
    }
    func interrupt() { cancelResponse(); if running { set(isMuted ? .muted : .listening, isMuted ? "Micrófono apagado" : "Te escucho") } }
    func stop() { generation = UUID(); running = false; lifecycle?.cancel(); lifecycle = nil; sender?.cancel(); sender = nil; cancelResponse(); pcm.removeAll(); transport.close(); audio.close(); inputLevel = 0; outputLevel = 0; set(.stopped, "Hablar con Melodi") }
    private func fail(_ text: String) { stop(); set(.failed, text) }
}
