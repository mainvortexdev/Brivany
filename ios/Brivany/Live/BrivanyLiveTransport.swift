import Foundation

@MainActor final class BrivanyLiveTransport: BrivanyLiveTransportIO {
    private let configuration: MobileConfiguration
    private let session: URLSession
    private let conversationID = UUID()
    private var socket: URLSessionWebSocketTask?
    private var receiver: Task<Void, Never>?
    private var parser = BrivanyASRParser()
    private var pumps: [UUID: Task<Void, Never>] = [:]
    private var closed = false
    init(configuration: MobileConfiguration) {
        self.configuration = configuration
        let options = URLSessionConfiguration.ephemeral; options.timeoutIntervalForRequest = 30; options.timeoutIntervalForResource = 120; options.urlCache = nil
        session = URLSession(configuration: options, delegate: BrivanyNoRedirect(), delegateQueue: nil)
    }
    private func request(_ path: String, body: Any? = nil) throws -> URLRequest {
        guard configuration.baseURL.scheme == "https", configuration.baseURL.host != nil, configuration.baseURL.user == nil, configuration.baseURL.password == nil, configuration.baseURL.query == nil, configuration.baseURL.fragment == nil,
              !configuration.token.isEmpty, configuration.token.utf8.count <= 4096, !configuration.token.contains(where: { $0.isWhitespace || $0.isNewline }) else { throw BrivanyLiveError.message("Configura una conexión HTTPS de Brivany.") }
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent(path)); request.timeoutInterval = 45
        request.setValue("Bearer " + configuration.token, forHTTPHeaderField: "Authorization"); request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body { request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return request
    }
    func connect(onEvent: @escaping (BrivanyASREvent) -> Void, onFailure: @escaping (String) -> Void) async throws {
        closed = false; parser = BrivanyASRParser()
        let (_, response) = try await session.data(for: request("health")); try validate(response)
        var req = try request("v1/asr"); var components = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!; components.scheme = "wss"; req.url = components.url
        let ws = session.webSocketTask(with: req); socket = ws; ws.resume(); try await ws.send(.string("{\"type\":\"start\"}"))
        let watchdog = Task { try? await Task.sleep(for: .seconds(10)); if !Task.isCancelled { ws.cancel(with: .goingAway, reason: nil) } }
        defer { watchdog.cancel() }
        let initial = try await ws.receive(); try Task.checkCancellation(); let data = try Self.data(initial)
        guard try parser.accept(data) == .ready else { throw BrivanyLiveError.message("No se pudo iniciar el reconocimiento de voz.") }
        onEvent(.ready)
        receiver = Task { [weak self] in
            guard let self else { return }
            do {
                while !Task.isCancelled && !closed {
                    let message = try await ws.receive(); try Task.checkCancellation()
                    if let event = try parser.accept(Self.data(message)) { onEvent(event) }
                }
            } catch { if !closed && !Task.isCancelled { onFailure("Se perdió la conexión de voz. Puedes volver a iniciar.") } }
        }
    }
    private static func data(_ message: URLSessionWebSocketTask.Message) throws -> Data {
        switch message { case .data(let value): return value; case .string(let value): return Data(value.utf8); @unknown default: throw BrivanyLiveError.message("Respuesta de voz no válida.") }
    }
    func send(_ pcm: Data) async throws { guard !closed, pcm.count == 3840, let socket else { throw BrivanyLiveError.message("La escucha está desconectada.") }; try await socket.send(.data(pcm)) }
    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode
            throw BrivanyLiveError.message(code == 401 || code == 403 ? "Revisa la vinculación de este iPhone." : "El servicio de Melodi no está disponible.")
        }
    }
    func chat(_ messages: [BrivanyLiveMessage]) async throws -> AsyncThrowingStream<String, Error> {
        let history = Array(messages.suffix(12))
        let body: [String: Any] = ["messages": history.enumerated().map { index, item in ["role": item.role, "content": String(item.content.prefix(index == history.count - 1 ? 2400 : 1000))] }, "source": "voice", "nonce": UUID().uuidString.lowercased(), "conversation_id": conversationID.uuidString.lowercased()]
        let (bytes, response) = try await session.bytes(for: request("v1/chat", body: body)); try validate(response)
        guard (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/x-ndjson") == true else { throw BrivanyLiveError.message("No se recibió una respuesta en directo.") }
        let id = UUID(); let (stream, continuation) = AsyncThrowingStream<String, Error>.makeStream()
        let pump = Task { [weak self] in
            defer { self?.pumps.removeValue(forKey: id) }
            do { var decoder = BrivanyNDJSONParser(); for try await byte in bytes { try Task.checkCancellation(); if let text = try decoder.append(byte) { continuation.yield(text) }; if decoder.completed { break } }; try decoder.finish(); continuation.finish() }
            catch { continuation.finish(throwing: error) }
        }
        pumps[id] = pump; continuation.onTermination = { _ in pump.cancel() }; return stream
    }
    func speech(_ text: String) async throws -> AsyncThrowingStream<Data, Error> {
        guard !text.isEmpty, text.utf16.count <= 6000 else { throw BrivanyLiveError.message("La frase no es válida.") }
        let (bytes, response) = try await session.bytes(for: request("v1/speech", body: ["text": text])); try validate(response)
        guard (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("audio/pcm") == true else { throw BrivanyLiveError.message("No se recibió la voz de Melodi.") }
        let id = UUID(); let (stream, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let pump = Task { [weak self] in
            defer { self?.pumps.removeValue(forKey: id) }
            do { var block = Data(); var total = 0; for try await byte in bytes { try Task.checkCancellation(); block.append(byte); total += 1; guard total <= 12_000_000 else { throw BrivanyLiveError.message("La voz excedió su límite.") }; if block.count >= 2400 { continuation.yield(block); block.removeAll(keepingCapacity: true) } }; if !block.isEmpty { continuation.yield(block) }; continuation.finish() }
            catch { continuation.finish(throwing: error) }
        }
        pumps[id] = pump; continuation.onTermination = { _ in pump.cancel() }; return stream
    }
    func close() { closed = true; receiver?.cancel(); receiver = nil; socket?.cancel(with: .normalClosure, reason: nil); socket = nil; pumps.values.forEach { $0.cancel() }; pumps.removeAll() }
}
private final class BrivanyNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
