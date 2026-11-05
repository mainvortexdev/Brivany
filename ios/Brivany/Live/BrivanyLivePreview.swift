#if DEBUG
import Foundation

@MainActor extension BrivanyLiveSession {
    static func preview() -> BrivanyLiveSession {
        BrivanyLiveSession(audio: BrivanyPreviewAudio(), transport: BrivanyPreviewTransport())
    }
}
@MainActor private final class BrivanyPreviewAudio: BrivanyLiveAudioIO {
    var onPCM: ((Data, Double) -> Void)?
    var onFailure: ((String) -> Void)?
    var onOutputLevel: ((Double) -> Void)?
    private var meter: Task<Void, Never>?
    private var muted = false
    func start() async throws {
        meter = Task { [weak self] in
            while !Task.isCancelled { try? await Task.sleep(for: .milliseconds(90)); guard !Task.isCancelled, let self else { return }; self.onPCM?(Data(repeating: 0, count: 3840), muted ? 0 : .16) }
        }
    }
    func setMuted(_ value: Bool) { muted = value }
    func play(_ chunks: AsyncThrowingStream<Data, Error>, onStarted: @escaping () -> Void) async throws { onStarted(); for try await _ in chunks { try Task.checkCancellation() } }
    func interrupt() { onOutputLevel?(0) }
    func close() { meter?.cancel(); meter = nil }
}
@MainActor private final class BrivanyPreviewTransport: BrivanyLiveTransportIO {
    func connect(onEvent: @escaping (BrivanyASREvent) -> Void, onFailure: @escaping (String) -> Void) async throws { onEvent(.ready) }
    func send(_ pcm: Data) async throws {}
    func chat(_ messages: [BrivanyLiveMessage]) async throws -> AsyncThrowingStream<String, Error> { AsyncThrowingStream { $0.yield("Vista de interfaz con audio simulado."); $0.finish() } }
    func speech(_ text: String) async throws -> AsyncThrowingStream<Data, Error> { AsyncThrowingStream { $0.finish() } }
    func close() {}
}
#endif
