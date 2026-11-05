import Foundation
import Combine

struct ChatMessage: Identifiable, Codable, Equatable {
    var id = UUID()
    let role: String
    var content: String
}

protocol ChatService {
    func response(_ messages: [ChatMessage]) -> AsyncThrowingStream<String, Error>
}

final class NoMobileRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

final class MobileAPI: ChatService {
    let configuration: MobileConfiguration
    private let session: URLSession
    private let conversationID: UUID
    init(configuration: MobileConfiguration, conversationID: UUID = UUID()) {
        self.configuration = configuration
        self.conversationID = conversationID
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 90
        session = URLSession(configuration: config, delegate: NoMobileRedirect(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    private func request(_ path: String) -> URLRequest {
        var request = URLRequest(url: configuration.baseURL.appendingPathComponent(path))
        request.setValue("Bearer " + configuration.token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
    func verify() async throws {
        let (data, response) = try await session.data(for: request("v1/config"))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count < 16_384 else { throw MobileError.message("No se pudo verificar la conexión con Brivany.") }
    }
    static func login(email: String, password: String, device: String) async throws -> MobileConfiguration {
        let options = URLSessionConfiguration.ephemeral
        options.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: options, delegate: NoMobileRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: MobileConfiguration.service.appendingPathComponent("v1/account/login"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password, "device_id": device, "device_name": "iPhone", "kind": "mobile", "platform": "ios"])
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 32_768 else { throw MobileError.message("No se pudo iniciar sesión. Revisa el correo y la contraseña.") }
        struct Result: Decodable { struct Session: Decodable { let token: String; let device_id: String }; let account: MobileAccount; let session: Session }
        let result = try JSONDecoder().decode(Result.self, from: data)
        var configuration = MobileConfiguration(baseURL: .init(string: "https://mobile.brivany.example")!, token: result.session.token)
        configuration.account = result.account; configuration.deviceID = result.session.device_id
        return try configuration.validated()
    }
    func computers() async throws -> [AccountComputer] {
        let (data, response) = try await session.data(for: request("v1/devices"))
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 65_536 else { throw MobileError.message("No se pudieron consultar tus ordenadores.") }
        struct Result: Decodable { let devices: [AccountComputer] }
        return try JSONDecoder().decode(Result.self, from: data).devices.filter { $0.kind == "desktop" && $0.enabled }
    }
    func logout() async throws { var value = request("v1/account/logout"); value.httpMethod = "POST"; value.httpBody = Data("{}".utf8); _ = try await session.data(for: value) }
    func response(_ messages: [ChatMessage]) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = request("v1/chat"); request.httpMethod = "POST"
                    let history = Array(messages.suffix(12))
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["messages": history.enumerated().map { index, item in ["role": item.role, "content": String(item.content.prefix(index == history.count - 1 ? 2400 : 1000))] }, "source": "chat", "nonce": UUID().uuidString.lowercased(), "conversation_id": conversationID.uuidString.lowercased()])
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw MobileError.message("Melodi no pudo responder. Comprueba la conexión.") }
                    var count = 0; var completed = false
                    for try await line in bytes.lines {
                        try Task.checkCancellation(); guard line.utf8.count <= 32_768 else { throw MobileError.message("La respuesta superó su límite.") }
                        guard let data = line.data(using: .utf8), let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                        if event["type"] as? String == "error" { throw MobileError.message("No se pudo completar la respuesta.") }
                        if event["type"] as? String == "done" { completed = true; break }
                        if event["type"] as? String == "delta", let text = event["text"] as? String {
                            count += text.count; guard count <= 12_000 else { throw MobileError.message("La respuesta superó su límite.") }
                            continuation.yield(text)
                        }
                    }
                    guard completed else { throw MobileError.message("La conexión se interrumpió. Puedes volver a intentarlo.") }
                    continuation.finish()
                } catch { continuation.finish(throwing: error) }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

struct PreviewChatService: ChatService {
    func response(_ messages: [ChatMessage]) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield("Podemos empezar con la idea principal y desarrollar un paso cada vez.")
            continuation.finish()
        }
    }
}

@MainActor final class BrivanyChatStore: ObservableObject {
    private(set) var conversationID = UUID()
    @Published var messages: [ChatMessage] = []
    @Published private(set) var busy = false
    @Published var error: String?
    private var task: Task<Void, Never>?
    private var generation = 0
    func send(_ text: String, service: ChatService) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= 2400, !busy else { return }
        generation += 1; let current = generation
        messages.append(ChatMessage(role: "user", content: clean)); let history = messages
        messages.append(ChatMessage(role: "assistant", content: "")); let id = messages.last!.id
        busy = true; error = nil
        task = Task {
            do {
                for try await delta in service.response(history) {
                    guard current == generation, !Task.isCancelled else { return }
                    if let index = messages.firstIndex(where: { $0.id == id }) { messages[index].content += delta }
                }
            } catch { if current == generation && !Task.isCancelled { self.error = error.localizedDescription } }
            if current == generation { busy = false; task = nil }
        }
    }
    func stop() { generation += 1; task?.cancel(); task = nil; busy = false; messages.removeAll { $0.role == "assistant" && $0.content.isEmpty } }
    func clear() { stop(); messages = []; error = nil; conversationID = UUID() }
}
