import SwiftUI

struct BrivanyLiveView: View {
    @ObservedObject var session: BrivanyLiveSession
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var minimized = false
    @State private var settings = false
    @State private var draft = ""
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { minimized.toggle() } label: { Image(systemName: minimized ? "chevron.up" : "chevron.down").frame(width: 40, height: 44) }.accessibilityLabel(minimized ? "Volver al modo de voz" : "Ver conversación")
                Spacer(); Text(minimized ? "Conversación con Melodi" : "Melodi Live").font(.caption).foregroundStyle(.secondary); Spacer()
                Button { settings = true } label: { Image(systemName: "slider.horizontal.3").frame(width: 40, height: 44) }.accessibilityLabel("Ajustes de voz")
            }.font(.title3).padding(.horizontal, 12)
            if minimized { transcript } else { orb }
            if session.state == .failed { Text(session.stateText).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(18); Button("Volver a iniciar") { session.start() }.padding(.bottom, 15) }
            if minimized {
                Button { minimized = false } label: {
                    HStack(spacing: 12) { Circle().fill(LinearGradient(colors: [.blue, .white], startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 34, height: 34); VStack(alignment: .leading, spacing: 4) { Text("Melodi").font(.caption.bold()); Text("Volver al modo de voz").font(.caption2).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "arrow.up.right").font(.caption) }
                        .padding(12).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 22))
                }.buttonStyle(.plain).padding(.horizontal, 18).padding(.bottom, 8)
            }
            controls
        }.background(BrivanyStyle.background.ignoresSafeArea())
            .task { session.start() }.onDisappear { session.stop() }
            .onChange(of: phase) { _, value in if value == .background { session.stop() } }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.23), value: minimized)
            .sheet(isPresented: $settings) { NavigationStack { Form { LabeledContent("Voz", value: "Melodi"); Toggle("Micrófono", isOn: Binding(get: { !session.isMuted }, set: { if $0 == session.isMuted { session.toggleMute() } })) }.navigationTitle("Voz").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { settings = false } } } }.presentationDetents([.height(250)]) }
    }
    private var orb: some View {
        VStack(spacing: 24) {
            Spacer()
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || session.state != .speaking)) { context in
                let angle = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 45) * 8
                ZStack {
                    Circle().fill(LinearGradient(colors: [Color(red: 0.18, green: 0.37, blue: 0.91), Color(red: 0.66, green: 0.77, blue: 1)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Ellipse().fill(.white.opacity(0.9)).frame(width: 290, height: 50).blur(radius: 19).rotationEffect(.degrees(-28 + angle)).offset(y: 20 - session.outputLevel * 10)
                }.frame(width: 220, height: 220).clipShape(Circle()).scaleEffect(reduceMotion ? 1 : 1 + max(session.inputLevel, session.outputLevel) * 0.08)
            }.accessibilityHidden(true)
            Text(session.state == .failed ? "" : session.stateText).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("live-state")
            if session.state == .speaking { Button("Detener respuesta") { session.interrupt() }.font(.caption) }
            Spacer()
        }.frame(maxWidth: .infinity)
    }
    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(Array(session.messages.enumerated()), id: \.offset) { index, message in
                        HStack { if message.role == "user" { Spacer(minLength: 30) }; Text(message.content).font(.subheadline).textSelection(.enabled).padding(message.role == "user" ? 14 : 0).background(message.role == "user" ? BrivanyStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 22)); if message.role != "user" { Spacer(minLength: 0) } }.id(index)
                    }
                    if !session.transcript.isEmpty && session.messages.last?.content != session.transcript { Text(session.transcript).font(.subheadline).foregroundStyle(.secondary) }
                }.padding(22)
            }.onChange(of: session.messages.count) { _, _ in if !session.messages.isEmpty { proxy.scrollTo(session.messages.count - 1, anchor: .bottom) } }
        }
    }
    private var controls: some View {
        HStack(alignment: .bottom, spacing: 10) {
            HStack(spacing: 8) {
                TextField("Escribe a Melodi", text: $draft, axis: .vertical).font(.subheadline).lineLimit(1...3).onSubmit(send).accessibilityIdentifier("live-message-input")
                if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { Button(action: send) { Image(systemName: "arrow.up").font(.subheadline.weight(.semibold)).frame(width: 31, height: 31).background(Color.primary, in: Circle()).foregroundStyle(BrivanyStyle.background) }.accessibilityLabel("Enviar mensaje") }
            }.padding(13).background(BrivanyStyle.surface, in: RoundedRectangle(cornerRadius: 27))
            Button { session.toggleMute() } label: { Image(systemName: session.isMuted ? "mic.slash" : "mic.fill").frame(width: 46, height: 46).background(BrivanyStyle.surface, in: Circle()) }.accessibilityLabel(session.isMuted ? "Activar micrófono" : "Silenciar micrófono").disabled(session.state == .connecting)
            Button { session.stop(); dismiss() } label: { Image(systemName: "xmark").frame(width: 46, height: 46).background(Color.primary, in: Circle()).foregroundStyle(BrivanyStyle.background) }.accessibilityLabel("Finalizar conversación").accessibilityIdentifier("live-close")
        }.buttonStyle(.plain).font(.title3).padding(.horizontal, 18).padding(.bottom, 10)
    }
    private func send() { let text = draft.trimmingCharacters(in: .whitespacesAndNewlines); guard !text.isEmpty, text.utf16.count <= 2400 else { return }; session.send(text); draft = "" }
}
