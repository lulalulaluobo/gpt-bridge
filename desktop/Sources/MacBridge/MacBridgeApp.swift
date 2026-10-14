import SwiftUI

@main
struct MacBridgeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()
    var body: some Scene {
        Window("gpt-bridge", id: "settings") {
            SettingsView(model: model)
                .frame(minWidth: 900, minHeight: 620)
        }
        .defaultSize(width: 1060, height: 760)
        .windowResizability(.contentMinSize)
        MenuBarExtra("gpt-bridge", systemImage: model.isConnected ? "link.circle.fill" : "link.circle") {
            MenuContent(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}
