import SwiftUI
import UniformTypeIdentifiers
import QuickLook
import AVKit

struct BrivanyModulesView: View {
    let send: (String) -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                BrivanyWordmark().padding(.top, 8)
                Text("Módulos").font(BrivanyStyle.title())
                VStack(spacing: 12) {
                    NavigationLink { HumanSkillsView(send: send) } label: { module("Human-skills", symbol: "person.wave.2", detail: "Practicar y preparar") }
                    NavigationLink { SpacesView() } label: { module("Espacios", symbol: "cube.transparent", detail: "Modelos 3D") }
                    NavigationLink { VideoToolsView() } label: { module("Video", symbol: "play.rectangle", detail: "Reproducir y extraer audio") }
                }.buttonStyle(.plain)
            }.padding(24)
        }.navigationTitle("")
    }
    private func module(_ title: String, symbol: String, detail: String) -> some View {
        HStack(spacing: 18) {
            Image(systemName: symbol).font(.system(size: 23, weight: .light)).frame(width: 38)
            VStack(alignment: .leading, spacing: 7) { Text(title).font(.headline); Text(detail).font(.caption).foregroundStyle(.secondary) }
            Spacer(minLength: 8); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }.padding(22).frame(maxWidth: .infinity, minHeight: 100, alignment: .leading).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 22))
    }
}

struct HumanSkillsView: View {
    let send: (String) -> Void
    @State private var practice = "Presentación"
    @State private var draft = ""
    @State private var recording = false
    @State private var seconds = 0
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Picker("Práctica", selection: $practice) { Text("Presentación").tag("Presentación"); Text("Entrevista").tag("Entrevista"); Text("Idiomas").tag("Idiomas") }.pickerStyle(.segmented)
            Text(practice == "Presentación" ? "Tu idea en un minuto." : practice == "Entrevista" ? "Prepara tu respuesta." : "Una conversación, otro idioma.").font(BrivanyStyle.title(30))
            TextEditor(text: $draft).scrollContentBackground(.hidden).padding(14).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 20)).accessibilityLabel("Texto para practicar")
            HStack {
                Button { recording.toggle(); if recording { seconds = 0 } } label: { Label(recording ? "\(seconds) s" : "Cronómetro", systemImage: recording ? "stop" : "timer").frame(minHeight: 44) }.buttonStyle(.bordered)
                Spacer()
                Button("Revisar con Melodi") { send("Ayúdame a practicar \(practice.lowercased()). Revisa este texto y dame una mejora concreta: \(draft)") }.buttonStyle(.borderedProminent).disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 1800)
            }
        }.padding(24).navigationTitle("Human-skills").navigationBarTitleDisplayMode(.inline)
            .onReceive(timer) { _ in if recording { seconds += 1 } }
            .onDisappear { recording = false }
    }
}

enum LocalLibrary {
    static func folder(_ name: String) throws -> URL {
        let path = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        return path
    }
    static func importFile(_ source: URL, folder: String, maxBytes: Int = 300_000_000) throws -> URL {
        let access = source.startAccessingSecurityScopedResource(); defer { if access { source.stopAccessingSecurityScopedResource() } }
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= maxBytes else { throw MobileError.message("Elige un archivo de hasta \(maxBytes / 1_000_000) MB.") }
        let suffix = source.pathExtension.lowercased()
        let clean = source.deletingPathExtension().lastPathComponent.prefix(80)
        let target = try Self.folder(folder).appendingPathComponent("\(clean)-\(UUID().uuidString.prefix(6)).\(suffix)")
        try FileManager.default.copyItem(at: source, to: target)
        return target
    }
}

struct SpacesView: View {
    @State private var importing = false
    @State private var models: [URL] = []
    @State private var preview: URL?
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Espacios").font(BrivanyStyle.title())
                Button { importing = true } label: { Label("Importar modelo USDZ", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 48) }.buttonStyle(.bordered)
                if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
                ForEach(models, id: \.self) { model in
                    Button { preview = model } label: { HStack(spacing: 16) { Image(systemName: "cube").font(.title2); Text(model.deletingPathExtension().lastPathComponent).lineLimit(2); Spacer(); Image(systemName: "arrow.up.right").font(.caption) }.padding(20).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 20)) }.buttonStyle(.plain)
                }
            }.padding(24)
        }.navigationTitle("").quickLookPreview($preview)
            .task { reload() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "usdz") ?? .data]) { result in
                do { let url = try result.get(); guard url.pathExtension.lowercased() == "usdz" else { throw MobileError.message("Elige un modelo USDZ.") }; _ = try LocalLibrary.importFile(url, folder: "Espacios", maxBytes: 100_000_000); reload() }
                catch { self.error = error.localizedDescription }
            }
    }
    private func reload() { models = (try? FileManager.default.contentsOfDirectory(at: LocalLibrary.folder("Espacios"), includingPropertiesForKeys: nil).filter { $0.pathExtension.lowercased() == "usdz" }.sorted { $0.lastPathComponent < $1.lastPathComponent }) ?? [] }
}

struct VideoToolsView: View {
    @State private var importing = false
    @State private var video: URL?
    @State private var player: AVPlayer?
    @State private var output: URL?
    @State private var exporting = false
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Video").font(BrivanyStyle.title())
                Button { importing = true } label: { Label("Elegir video", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 48) }.buttonStyle(.bordered)
                if let player { VideoPlayer(player: player).aspectRatio(16 / 9, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 20)) }
                if let video { Text(video.lastPathComponent).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Button { Task { await extract(video) } } label: { HStack { Text(exporting ? "Extrayendo audio…" : "Extraer audio"); Spacer(); if exporting { ProgressView() } else { Image(systemName: "waveform") } }.frame(minHeight: 44) }.buttonStyle(.borderedProminent).disabled(exporting)
                }
                if let output { ShareLink(item: output) { Label("Guardar o compartir audio", systemImage: "square.and.arrow.up").frame(minHeight: 44) } }
                if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            }.padding(24)
        }.navigationTitle("").onDisappear { player?.pause() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.movie]) { result in
                do { let imported = try LocalLibrary.importFile(result.get(), folder: "Video"); video = imported; player = AVPlayer(url: imported); output = nil; error = nil }
                catch { self.error = error.localizedDescription }
            }
    }
    @MainActor private func extract(_ source: URL) async {
        guard !exporting else { return }; exporting = true; error = nil; defer { exporting = false }
        do {
            let asset = AVURLAsset(url: source)
            guard !(try await asset.loadTracks(withMediaType: .audio)).isEmpty else { throw MobileError.message("El video no tiene una pista de audio.") }
            guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else { throw MobileError.message("No se pudo preparar el audio.") }
            let destination = try LocalLibrary.folder("Audio").appendingPathComponent("\(source.deletingPathExtension().lastPathComponent).m4a")
            guard !FileManager.default.fileExists(atPath: destination.path) else { throw MobileError.message("Ese audio ya existe. Puedes compartirlo desde Archivos.") }
            exporter.outputURL = destination; exporter.outputFileType = .m4a
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in exporter.exportAsynchronously { continuation.resume() } }
            guard exporter.status == .completed else { throw MobileError.message("La extracción no pudo completarse.") }
            output = destination
        } catch { self.error = error.localizedDescription }
    }
}
