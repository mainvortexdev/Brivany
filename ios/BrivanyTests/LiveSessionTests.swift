import XCTest
import AVFoundation
@testable import Brivany

final class LiveCoreTests: XCTestCase {
    func testLateNumericTurnCannotReplaceTheActiveSpeakerTurn() throws {
        var parser = BrivanyASRParser()
        _ = try parser.accept(Data(#"{"type":"speechStart","turnId":1}"#.utf8))
        _ = try parser.accept(Data(#"{"type":"speechStart","turnId":2}"#.utf8))
        XCTAssertEqual(try parser.accept(Data(#"{"type":"speechComplete","turnId":1,"transcript":"Primero"}"#.utf8)), .transcript("1", "Primero", true))
        XCTAssertEqual(try parser.accept(Data(#"{"type":"speechComplete","turnId":2,"transcript":"Segundo"}"#.utf8)), .transcript("2", "Segundo", true))
        XCTAssertNil(try parser.accept(Data(#"{"type":"speechComplete","turnId":1,"transcript":"Primero"}"#.utf8)))
    }
    func testASRDoesNotCommitProvisionalFinalAndDeduplicatesSpeechComplete() throws {
        var parser = BrivanyASRParser()
        XCTAssertEqual(try parser.accept(Data(#"{"sessionId":"fixture"}"#.utf8)), .ready)
        XCTAssertEqual(try parser.accept(Data(#"{"type":"speechStart","turnId":"a"}"#.utf8)), .speechStart("a"))
        XCTAssertEqual(try parser.accept(Data(#"{"type":"transcript","transcript":"Una idea","final":true}"#.utf8)), .transcript("a", "Una idea", false))
        XCTAssertEqual(try parser.accept(Data(#"{"type":"speechComplete","turnId":"a","transcript":"Una idea completa"}"#.utf8)), .transcript("a", "Una idea completa", true))
        XCTAssertNil(try parser.accept(Data(#"{"type":"speechComplete","turnId":"a","transcript":"Una idea completa"}"#.utf8)))
    }
    func testNDJSONRequiresDoneAndBoundsMalformedRows() throws {
        var parser = BrivanyNDJSONParser(); var text = ""
        for byte in Data("{\"type\":\"delta\",\"text\":\"Hola\"}\n{\"type\":\"done\"}\n".utf8) { if let delta = try parser.append(byte) { text += delta } }
        try parser.finish(); XCTAssertEqual(text, "Hola")
        var incomplete = BrivanyNDJSONParser(); for byte in Data("{\"type\":\"delta\",\"text\":\"Hola\"}\n".utf8) { _ = try incomplete.append(byte) }; XCTAssertThrowsError(try incomplete.finish())
    }
    func testPCMFramingPreservesOrderAcrossCaptureBoundariesAndLittleEndianCarry() throws {
        let raw = Data((0..<7680).map { UInt8($0 % 251) }); var framer = BrivanyPCMFramer(); var frames = framer.append(Data(raw.prefix(1000))); frames += framer.append(Data(raw.dropFirst(1000)))
        XCTAssertEqual(frames.count, 2); XCTAssertTrue(frames.allSatisfy { $0.count == 3840 }); XCTAssertEqual(frames.reduce(Data(), +), raw)
        var decoder = BrivanyPCMDecoder(); XCTAssertEqual(try decoder.append(Data([0])), []); XCTAssertEqual(try decoder.append(Data([128, 255, 127])), [-1, Float(32767) / 32768]); _ = try decoder.append(Data(), final: true)
        _ = try decoder.append(Data([1])); XCTAssertThrowsError(try decoder.append(Data(), final: true))
    }
    func testPhrasesStreamUsefulSentencesAndNeverLoseTheShortTail() {
        var phrases = BrivanySpeechPhrases(); XCTAssertEqual(phrases.append("Esta es una primera frase que ya podemos escuchar. "), ["Esta es una primera frase que ya podemos escuchar."])
        XCTAssertEqual(phrases.append("Y el final"), []); XCTAssertEqual(phrases.append("", final: true), ["Y el final"])
    }
    func testRealAVAudioConverterDownsamplesDeviceRateAndFramesMonoWithoutOpeningMicrophone() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)), converter = try BrivanyCaptureConverter(input: format)
        var result: [(Data, Double)] = []
        for _ in 0..<10 {
            let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 3840)); input.frameLength = 3840
            for channel in 0..<2 { let values = try XCTUnwrap(input.floatChannelData?[channel]); for i in 0..<3840 { values[i] = .2 } }
            result += try converter.convert(input)
        }
        // 0.8 s at 48 kHz becomes 0.8 s at 24 kHz, not a re-labelled 1.6 s.
        // Allow one frame for the converter's filter priming / remaining tail.
        XCTAssertTrue((9...10).contains(result.count)); XCTAssertTrue(result.allSatisfy { $0.0.count == 3840 }); XCTAssertTrue(result.dropFirst().allSatisfy { $0.1 > .1 })
        converter.setMuted(true)
        let muted = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 7680)); muted.frameLength = 7680
        for channel in 0..<2 { let values = try XCTUnwrap(muted.floatChannelData?[channel]); for i in 0..<7680 { values[i] = .4 } }
        let silent = try converter.convert(muted); XCTAssertFalse(silent.isEmpty); XCTAssertTrue(silent.allSatisfy { $0.0 == Data(repeating: 0, count: 3840) && $0.1 == 0 })
    }
}

@MainActor private final class FixtureAudio: BrivanyLiveAudioIO {
    var onPCM: ((Data, Double) -> Void)?; var onFailure: ((String) -> Void)?; var onOutputLevel: ((Double) -> Void)?
    var starts = 0; var closes = 0; var interruptions = 0; var muted = false; var holdPlayback = false
    func start() async throws { starts += 1 }
    func setMuted(_ value: Bool) { muted = value }
    func play(_ chunks: AsyncThrowingStream<Data, Error>, onStarted: @escaping () -> Void) async throws { onStarted(); for try await _ in chunks { try Task.checkCancellation() }; if holdPlayback { try await Task.sleep(for: .seconds(30)) } }
    func interrupt() { interruptions += 1 }
    func close() { closes += 1 }
}
@MainActor private final class FixtureTransport: BrivanyLiveTransportIO {
    var event: ((BrivanyASREvent) -> Void)?; var closed = 0; var sent: [Data] = []; var conversations: [[BrivanyLiveMessage]] = []; var delayedDelta: AsyncThrowingStream<String, Error>.Continuation?
    var delayReply = false
    func connect(onEvent: @escaping (BrivanyASREvent) -> Void, onFailure: @escaping (String) -> Void) async throws { event = onEvent; onEvent(.ready) }
    func send(_ pcm: Data) async throws { sent.append(pcm) }
    func chat(_ messages: [BrivanyLiveMessage]) async throws -> AsyncThrowingStream<String, Error> {
        conversations.append(messages)
        return AsyncThrowingStream { continuation in if delayReply { delayedDelta = continuation } else { continuation.yield("Esta es una respuesta de prueba suficientemente larga."); continuation.finish() } }
    }
    func speech(_ text: String) async throws -> AsyncThrowingStream<Data, Error> { AsyncThrowingStream { $0.yield(Data(repeating: 0, count: 2400)); $0.finish() } }
    func close() { closed += 1 }
}
@MainActor final class LiveSessionTests: XCTestCase {
    private func until(_ test: @escaping () -> Bool) async throws { for _ in 0..<100 { if test() { return }; try await Task.sleep(for: .milliseconds(5)) }; XCTFail("Fixture did not reach the expected state") }
    func testStartMuteAndStopCloseOwnedResourcesWithoutNetworkOrMicrophone() async throws {
        let audio = FixtureAudio(), transport = FixtureTransport(), session = BrivanyLiveSession(audio: audio, transport: transport)
        session.start(); try await until { session.state == .listening }; XCTAssertEqual(audio.starts, 1)
        session.toggleMute(); XCTAssertTrue(session.isMuted); XCTAssertTrue(audio.muted); XCTAssertEqual(session.state, .muted)
        audio.onPCM?(Data(repeating: 0, count: 3840), .5); try await until { transport.sent.count == 1 }; XCTAssertEqual(session.inputLevel, 0)
        session.stop(); XCTAssertEqual(session.state, .stopped); XCTAssertGreaterThan(audio.closes, 0); XCTAssertGreaterThan(transport.closed, 0)
    }
    func testLateChatDeltasCannotReanimateAStoppedSession() async throws {
        let audio = FixtureAudio(), transport = FixtureTransport(), session = BrivanyLiveSession(audio: audio, transport: transport); transport.delayReply = true
        session.start(); try await until { session.state == .listening }; transport.event?(.transcript("a", "Una pregunta", true)); try await until { transport.delayedDelta != nil }; session.stop()
        transport.delayedDelta?.yield("Una respuesta tardía que no debe aparecer."); transport.delayedDelta?.finish(); try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(session.state, .stopped); XCTAssertEqual(session.reply, "")
    }
    func testRecognizedBargeInCancelsSpeechAndProcessesTheNextUserTurn() async throws {
        let audio = FixtureAudio(), transport = FixtureTransport(), session = BrivanyLiveSession(audio: audio, transport: transport); audio.holdPlayback = true
        session.start(); try await until { session.state == .listening }; transport.event?(.transcript("a", "Primera pregunta", true)); try await until { session.state == .speaking }
        let before = audio.interruptions; transport.event?(.speechStart("b")); transport.event?(.transcript("b", "Espera", false)); XCTAssertEqual(session.state, .listening); XCTAssertGreaterThan(audio.interruptions, before)
        transport.event?(.transcript("b", "Otra pregunta", true)); try await until { transport.conversations.count == 2 }; XCTAssertEqual(transport.conversations.last?.last?.content, "Otra pregunta"); session.stop()
    }
    func testAudioRouteFailureStopsCaptureAndLeavesRecoverableState() async throws {
        let audio = FixtureAudio(), transport = FixtureTransport(), session = BrivanyLiveSession(audio: audio, transport: transport)
        session.start(); try await until { session.state == .listening }; audio.onFailure?("Cambió el micrófono."); XCTAssertEqual(session.state, .failed); XCTAssertEqual(session.stateText, "Cambió el micrófono."); XCTAssertEqual(session.inputLevel, 0)
    }
}
