import Foundation
import Security
import Combine
import UIKit

struct MobileAccount: Codable, Equatable {
    let id: String
    let name: String
    let email: String
}

struct AccountComputer: Codable, Identifiable {
    let id: String
    let name: String
    let platform: String
    let kind: String
    let online: Bool
    let enabled: Bool
}

struct MobileConfiguration: Codable, Equatable {
    let baseURL: URL
    let token: String
    var account: MobileAccount? = nil
    var deviceID: String? = nil
    static let service = URL(string: "https://mobile.brivany.example")!

    func validated() throws -> MobileConfiguration {
        guard baseURL.scheme == "https", baseURL.host == Self.service.host,
              baseURL.user == nil, baseURL.password == nil, baseURL.port == nil,
              baseURL.query == nil, baseURL.fragment == nil,
              baseURL.path.isEmpty || baseURL.path == "/",
              token.count >= 32, token.count <= 256,
              token.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (65...90).contains($0.value) || (97...122).contains($0.value) || "-_.".unicodeScalars.contains($0) }) else {
            throw MobileError.message("La conexión de Brivany no es válida.")
        }
        return self
    }
}

enum MobileError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): return text } }
}

protocol SecureConfigurationStorage {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func remove()
}

struct KeychainConfigurationStorage: SecureConfigurationStorage {
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "es.ProjectFixture.brivany", kSecAttrAccount as String: "mobile-connection"] }
    func read() throws -> Data? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw MobileError.message("No se pudo leer la conexión segura.") }
        return result as? Data
    }
    func write(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes, uniquingKeysWith: { _, new in new }) as CFDictionary, nil) == errSecSuccess else { throw MobileError.message("No se pudo guardar la conexión segura.") }; return
        }
        guard status == errSecSuccess else { throw MobileError.message("No se pudo guardar la conexión segura.") }
    }
    func remove() { SecItemDelete(query as CFDictionary) }
}

struct ConnectionDocument: Codable {
    let version: Int
    let base_url: URL
    let device_token: String
    func configuration() throws -> MobileConfiguration {
        guard version == 1 else { throw MobileError.message("Actualiza el archivo de conexión.") }
        return try MobileConfiguration(baseURL: base_url, token: device_token).validated()
    }
}

@MainActor final class ConnectionStore: ObservableObject {
    @Published private(set) var configuration: MobileConfiguration?
    @Published private(set) var verified = false
    @Published var error: String?
    @Published var checking = false
    @Published private(set) var computers: [AccountComputer] = []
    private let storage: SecureConfigurationStorage
    init(storage: SecureConfigurationStorage = KeychainConfigurationStorage()) {
        self.storage = storage
        do { if let data = try storage.read() { configuration = try JSONDecoder().decode(MobileConfiguration.self, from: data).validated() } }
        catch { self.error = "No se pudo recuperar la conexión. Vuelve a importarla." }
    }
    func importDocument(_ data: Data) throws {
        guard data.count <= 16_384 else { throw MobileError.message("El archivo de conexión es demasiado grande.") }
        let next = try JSONDecoder().decode(ConnectionDocument.self, from: data).configuration()
        try storage.write(JSONEncoder().encode(next)); configuration = next; verified = false; error = nil
    }
    func importFile(_ url: URL) throws {
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 16_384 else { throw MobileError.message("El archivo de conexión es demasiado grande.") }
        try importDocument(Data(contentsOf: url))
    }
    func verify() async {
        guard let configuration, !checking else { return }
        checking = true; defer { checking = false }
        do { let api = MobileAPI(configuration: configuration); try await api.verify(); computers = try await api.computers(); verified = true; error = nil }
        catch { verified = false; self.error = error.localizedDescription }
    }
    func login(email: String, password: String) async {
        guard !checking else { return }; checking = true; error = nil; defer { checking = false }
        var device = UserDefaults.standard.string(forKey: "brivany-device-id")
        if device == nil { device = UUID().uuidString.lowercased(); UserDefaults.standard.set(device, forKey: "brivany-device-id") }
        do {
            let next = try await MobileAPI.login(email: email, password: password, device: device!)
            try storage.write(JSONEncoder().encode(next)); configuration = next; verified = true
            computers = (try? await MobileAPI(configuration: next).computers()) ?? []
        } catch { self.error = error.localizedDescription }
    }
    func disconnect() {
        let prior = configuration
        storage.remove(); configuration = nil; verified = false; error = nil; computers = []
        if let prior { Task { try? await MobileAPI(configuration: prior).logout() } }
    }
}
