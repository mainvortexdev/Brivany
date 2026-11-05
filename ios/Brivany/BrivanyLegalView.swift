import SwiftUI
import WebKit

struct BrivanyLegalView: View {
    let title: String
    let path: String
    @State private var failed = false
    @State private var attempt = UUID()
    var body: some View {
        ZStack {
            LegalWebView(url: URL(string: "https://brivany.example/" + path)!, failed: $failed).id(attempt)
            if failed { VStack(spacing: 18) { Text("No se pudo cargar el documento.").font(.subheadline); Button("Reintentar") { failed = false; attempt = UUID() } }.padding(24).background(BrivanyStyle.background, in: RoundedRectangle(cornerRadius: 20)) }
        }.navigationTitle(title).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

private struct LegalWebView: UIViewRepresentable {
    let url: URL
    @Binding var failed: Bool
    func makeCoordinator() -> Coordinator { Coordinator(failed: $failed) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true; view.allowsLinkPreview = false
        view.load(URLRequest(url: url)); return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    final class Coordinator: NSObject, WKNavigationDelegate {
        let failed: Binding<Bool>
        init(failed: Binding<Bool>) { self.failed = failed }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, url.scheme == "https", url.host == "brivany.example", ["/privacidad", "/condiciones"].contains(url.path), url.user == nil, url.password == nil else { decisionHandler(.cancel); return }
            if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) } else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed.wrappedValue = true }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed.wrappedValue = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { failed.wrappedValue = false }
    }
}
