import SwiftUI
import UniformTypeIdentifiers

@main struct BrivanyApp: App {
    @StateObject private var connection = ConnectionStore()
    @StateObject private var chat = BrivanyChatStore()
    @AppStorage("appearance") private var appearance = "dark"
    var body: some Scene {
        WindowGroup {
            BrivanyRootView().environmentObject(connection).environmentObject(chat)
                .tint(BrivanyStyle.accent)
                .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
                .onOpenURL { url in do { try connection.importFile(url) } catch { connection.error = error.localizedDescription } }
        }
    }
}

enum BrivanyStyle {
    static let accent = Color(red: 0.53, green: 0.68, blue: 0.98)
    static let background = Color(uiColor: .systemBackground)
    static let surface = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.12, alpha: 1) : UIColor(white: 0.95, alpha: 1) })
    static func title(_ size: CGFloat = 32) -> Font { .custom("Georgia", size: size, relativeTo: .largeTitle) }
}

struct BrivanyWordmark: View {
    var body: some View { (Text("brivany").foregroundColor(.primary) + Text(".").foregroundColor(BrivanyStyle.accent)).font(.custom("Georgia-Bold", size: 26, relativeTo: .title2)).accessibilityLabel("Brivany") }
}

struct BrivanyRootView: View {
    @EnvironmentObject private var connection: ConnectionStore
    @EnvironmentObject private var chat: BrivanyChatStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tab = 1
    @State private var showConnection = false
    @State private var live = false
    private var testing: Bool { ProcessInfo.processInfo.arguments.contains("--ui-testing") }
    var body: some View {
        NavigationStack {
            Group {
                if tab == 0 { BrivanyModulesView { prompt in send(prompt) } }
                else if tab == 2 { BrivanySettingsView() }
                else { BrivanyChatView(openLive: openLive, send: send) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(BrivanyStyle.background)
                .toolbar(.hidden, for: .navigationBar)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 5) {
                tabButton("Módulos", icon: "square.grid.2x2", value: 0)
                tabButton("Melodi", icon: "bubble.left", value: 1)
                tabButton("Ajustes", icon: "gearshape", value: 2)
            }.padding(6).background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Color.primary.opacity(0.08), lineWidth: 1))
                .padding(.top, 10).padding(.bottom, 8)
        }
        .sheet(isPresented: $showConnection) { NavigationStack { BrivanyConnectionView() } }
        .fullScreenCover(isPresented: $live) {
            if testing { PreviewLiveContainer() }
            else if let configuration = connection.configuration { LiveContainer(configuration: configuration) }
        }
        .onAppear {
            let flags = ProcessInfo.processInfo.arguments
            if flags.contains("--preview-modules") { tab = 0 }
            else if flags.contains("--preview-settings") { tab = 2 }
            if testing && flags.contains("--preview-live") { live = true }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: tab)
        .onChange(of: connection.configuration?.account?.id) { _, _ in chat.clear(); live = false }
    }
    private func tabButton(_ text: String, icon: String, value: Int) -> some View {
        Button { tab = value } label: {
            VStack(spacing: 4) { Image(systemName: icon).font(.system(size: 18, weight: .medium)); Text(text).font(.caption2.weight(.medium)) }
                .frame(minWidth: 76, minHeight: 48).padding(.horizontal, 5)
                .foregroundStyle(tab == value ? BrivanyStyle.background : .secondary)
                .background(tab == value ? Color.primary : .clear, in: Capsule())
        }.buttonStyle(.plain).accessibilityIdentifier("tab-\(value)").accessibilityAddTraits(tab == value ? .isSelected : [])
    }
    private func send(_ text: String) {
        if testing { chat.send(text, service: PreviewChatService()); tab = 1 }
        else if let configuration = connection.configuration { chat.send(text, service: MobileAPI(configuration: configuration, conversationID: chat.conversationID)); tab = 1 }
        else { showConnection = true }
    }
    private func openLive() { if testing || connection.configuration != nil { live = true } else { showConnection = true } }
}

private struct LiveContainer: View {
    @StateObject private var session: BrivanyLiveSession
    init(configuration: MobileConfiguration) { _session = StateObject(wrappedValue: BrivanyLiveSession(configuration: configuration)) }
    var body: some View { BrivanyLiveView(session: session) }
}
private struct PreviewLiveContainer: View {
    #if DEBUG
    @StateObject private var session = BrivanyLiveSession.preview()
    var body: some View { BrivanyLiveView(session: session) }
    #else
    var body: some View { EmptyView() }
    #endif
}

struct BrivanyChatView: View {
    @EnvironmentObject private var chat: BrivanyChatStore
    let openLive: () -> Void
    let send: (String) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool
    var body: some View {
        VStack(spacing: 0) {
            HStack { BrivanyWordmark(); Spacer(); Button { chat.clear() } label: { Image(systemName: "square.and.pencil").frame(width: 44, height: 44) }.accessibilityLabel("Nueva conversación") }
                .padding(.horizontal, 24).padding(.top, 8)
            if chat.messages.isEmpty {
                Spacer(); Text("¿Qué creamos hoy?").font(BrivanyStyle.title()).multilineTextAlignment(.center).padding(.horizontal, 28); Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 22) {
                            ForEach(chat.messages) { message in
                                HStack {
                                    if message.role == "user" { Spacer(minLength: 36) }
                                    Text(message.content.isEmpty ? "…" : message.content).font(.body).textSelection(.enabled).lineSpacing(4)
                                        .padding(message.role == "user" ? 16 : 0)
                                        .background(message.role == "user" ? BrivanyStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 22))
                                    if message.role != "user" { Spacer(minLength: 16) }
                                }.id(message.id)
                            }
                        }.padding(24)
                    }.scrollDismissesKeyboard(.interactively)
                        .onChange(of: chat.messages) { _, messages in if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
                }
            }
            if let error = chat.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 24).padding(.bottom, 10) }
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Habla con Melodi…", text: $draft, axis: .vertical).lineLimit(1...5).focused($focused).accessibilityIdentifier("chat-input").onSubmit(submit)
                if chat.busy { Button { chat.stop() } label: { Image(systemName: "stop.fill").frame(width: 40, height: 40) }.accessibilityLabel("Detener respuesta") }
                else if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button { focused = false; openLive() } label: { Image(systemName: "mic.fill").frame(width: 40, height: 40) }.accessibilityLabel("Hablar con Melodi").accessibilityIdentifier("start-live")
                } else { Button(action: submit) { Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 40, height: 40).foregroundStyle(BrivanyStyle.background).background(Color.primary, in: Circle()) }.accessibilityLabel("Enviar mensaje") }
            }.padding(12).padding(.leading, 6).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 28)).padding(.horizontal, 18).padding(.bottom, 8)
        }
    }
    private func submit() { let text = draft.trimmingCharacters(in: .whitespacesAndNewlines); guard !text.isEmpty, text.count <= 2400, !chat.busy else { return }; send(text); draft = "" }
}
