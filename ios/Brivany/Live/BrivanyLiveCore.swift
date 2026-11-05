import Foundation

enum BrivanyLiveError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case let .message(value) = self { return value }; return nil }
}

enum BrivanyLiveState: String { case stopped, connecting, listening, thinking, speaking, muted, failed }
struct BrivanyLiveMessage: Codable, Equatable { let role: String; let content: String }
enum BrivanyASREvent: Equatable { case ready, speechStart(String), transcript(String, String, Bool) }

struct BrivanyASRParser {
    private var active: String?
    private var completed = Set<String>()
    mutating func accept(_ data: Data) throws -> BrivanyASREvent? {
        guard data.count <= 65536, let row = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BrivanyLiveError.message("Respuesta de voz no válida.") }
        let type = row["type"] as? String ?? ""
        if type == "error" { throw BrivanyLiveError.message("Se interrumpió el reconocimiento de voz.") }
        if row["sessionId"] is String || type == "ready" { return .ready }
        let suppliedID = (row["turnId"] as? String) ?? (row["id"] as? String) ?? (row["turnId"] as? NSNumber)?.stringValue ?? (row["id"] as? NSNumber)?.stringValue
        if type == "speechStart" || type == "speech-start" { let id = suppliedID ?? "current"; active = id; return .speechStart(id) }
        guard type == "transcript" || type == "speechComplete" else { return nil }
        let final = type == "speechComplete" || (row["source"] as? String == "muse_transcription" && row["final"] as? Bool == true)
        let id = suppliedID ?? active ?? "current"
        guard !completed.contains(id), let text = (row["transcript"] ?? row["text"]) as? String, text.utf16.count <= 10000 else { return nil }
        if final { completed.insert(id); if completed.count > 256 { completed = [id] } }
        return .transcript(id, text, final)
    }
}

struct BrivanyNDJSONParser {
    private var pending = Data()
    private(set) var completed = false
    private(set) var count = 0
    mutating func append(_ byte: UInt8) throws -> String? {
        guard !completed else { return nil }
        if byte != 10 { pending.append(byte); guard pending.count <= 65536 else { throw BrivanyLiveError.message("La respuesta excedió su límite.") }; return nil }
        defer { pending.removeAll(keepingCapacity: true) }
        guard !pending.isEmpty else { return nil }
        guard let event = try JSONSerialization.jsonObject(with: pending) as? [String: Any], let type = event["type"] as? String else { throw BrivanyLiveError.message("Respuesta de Melodi no válida.") }
        if type == "error" { throw BrivanyLiveError.message("Melodi no pudo completar la respuesta.") }
        if type == "computer_choice" || type == "computer_job" { return nil }
        if type == "done" { completed = true; return nil }
        guard type == "delta", let text = event["text"] as? String else { throw BrivanyLiveError.message("Respuesta de Melodi no válida.") }
        count += text.utf16.count; guard count <= 12000 else { throw BrivanyLiveError.message("La respuesta excedió su límite.") }; return text
    }
    func finish() throws { guard completed, count > 0 else { throw BrivanyLiveError.message("La respuesta se interrumpió.") } }
}

struct BrivanySpeechPhrases {
    private var pending = ""
    mutating func append(_ text: String, final: Bool = false) -> [String] {
        pending += text; var phrases: [String] = []
        while let range = pending.range(of: #"[.!?…](?:\s|$)"#, options: .regularExpression), pending.distance(from: pending.startIndex, to: range.upperBound) >= 24 {
            phrases.append(String(pending[..<range.upperBound]).trimmingCharacters(in: .whitespacesAndNewlines)); pending = String(pending[range.upperBound...])
        }
        if pending.count > 220, let boundary = pending.prefix(220).lastIndex(of: " ") { phrases.append(String(pending[..<boundary])); pending = String(pending[pending.index(after: boundary)...]) }
        if final { let last = pending.trimmingCharacters(in: .whitespacesAndNewlines); if !last.isEmpty { phrases.append(last) }; pending = "" }
        return phrases
    }
}

struct BrivanyPCMFramer {
    private var pending = Data()
    mutating func append(_ raw: Data) -> [Data] {
        pending.append(raw); var frames: [Data] = []
        while pending.count >= 3840 { frames.append(Data(pending.prefix(3840))); pending.removeFirst(3840) }
        return frames
    }
    mutating func reset() { pending.removeAll(keepingCapacity: false) }
}

struct BrivanyPCMDecoder {
    private var odd: UInt8?
    mutating func append(_ data: Data, final: Bool = false) throws -> [Float] {
        var bytes = Array(data); if let old = odd { bytes.insert(old, at: 0); odd = nil }; if bytes.count % 2 != 0 { odd = bytes.removeLast() }
        if final, odd != nil { throw BrivanyLiveError.message("La voz llegó incompleta.") }
        return stride(from: 0, to: bytes.count, by: 2).map { Float(Int16(bitPattern: UInt16(bytes[$0]) | UInt16(bytes[$0 + 1]) << 8)) / 32768 }
    }
}

@MainActor protocol BrivanyLiveAudioIO: AnyObject {
    var onPCM: ((Data, Double) -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    var onOutputLevel: ((Double) -> Void)? { get set }
    func start() async throws
    func setMuted(_ value: Bool)
    func play(_ chunks: AsyncThrowingStream<Data, Error>, onStarted: @escaping () -> Void) async throws
    func interrupt()
    func close()
}
@MainActor protocol BrivanyLiveTransportIO: AnyObject {
    func connect(onEvent: @escaping (BrivanyASREvent) -> Void, onFailure: @escaping (String) -> Void) async throws
    func send(_ pcm: Data) async throws
    func chat(_ messages: [BrivanyLiveMessage]) async throws -> AsyncThrowingStream<String, Error>
    func speech(_ text: String) async throws -> AsyncThrowingStream<Data, Error>
    func close()
}
