import SwiftUI
import UniformTypeIdentifiers

struct BrivanySettingsView: View {
    @EnvironmentObject private var connection: ConnectionStore
    @AppStorage("appearance") private var appearance = "dark"
    var body: some View {
        Form {
            Section {
                NavigationLink { BrivanyConnectionView() } label: { LabeledContent("Cuenta", value: connection.configuration?.account?.email ?? "Iniciar sesión") }
                LabeledContent("Voz", value: "Melodi")
            }
            Section {
                Picker("Apariencia", selection: $appearance) { Text("Sistema").tag("system"); Text("Oscura").tag("dark"); Text("Clara").tag("light") }
            }
            Section {
                NavigationLink("Privacidad") { BrivanyLegalView(title: "Privacidad", path: "privacidad") }
                NavigationLink("Condiciones de uso") { BrivanyLegalView(title: "Condiciones de uso", path: "condiciones") }
                LabeledContent("Versión", value: "0.1.0")
            }
        }.navigationTitle("Ajustes").toolbar(.visible, for: .navigationBar)
    }
}

struct BrivanyConnectionView: View {
    @EnvironmentObject private var connection: ConnectionStore
    @State private var email = ""
    @State private var password = ""
    @State private var confirming = false
    var body: some View {
        Form {
            if let account = connection.configuration?.account {
                Section {
                    LabeledContent("Nombre", value: account.name)
                    LabeledContent("Correo", value: account.email)
                }
                Section("Ordenadores") {
                    ForEach(connection.computers) { computer in
                        HStack { Image(systemName: "desktopcomputer"); Text(computer.name); Spacer(); Text(computer.online ? "Conectado" : "Sin conexión").font(.caption).foregroundStyle(.secondary) }
                    }
                    if connection.computers.isEmpty { Text("No hay ordenadores conectados a esta cuenta.").foregroundStyle(.secondary) }
                    Button("Actualizar") { Task { await connection.verify() } }.disabled(connection.checking)
                }
                Section { Button("Cerrar sesión", role: .destructive) { confirming = true } }
            } else {
                Section {
                    TextField("Correo", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("account-email")
                    SecureField("Contraseña", text: $password).textContentType(.password).accessibilityIdentifier("account-password")
                    Button(connection.checking ? "Conectando…" : "Iniciar sesión") {
                        Task { await connection.login(email: email, password: password); if connection.configuration?.account != nil { password = "" } }
                    }.disabled(connection.checking || email.isEmpty || password.isEmpty)
                }
            }
            if let error = connection.error { Section { Text(error).foregroundStyle(.secondary) } }
        }.navigationTitle("Cuenta Brivany").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
            .task { if connection.configuration != nil { await connection.verify() } }
            .confirmationDialog("¿Cerrar sesión en este iPhone?", isPresented: $confirming, titleVisibility: .visible) { Button("Cerrar sesión", role: .destructive) { connection.disconnect() } }
    }
}
