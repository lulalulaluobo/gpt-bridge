import SwiftUI

@main
struct MacBridgeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()
    @State private var capabilities = CapabilityModel()
    var body: some Scene {
        Window("gpt-bridge", id: "settings") {
            SettingsView(model: model)
                .frame(minWidth: 900, minHeight: 620)
        }
        .defaultSize(width: 1060, height: 760)
        .windowResizability(.contentMinSize)
        Window("技能与 CLI", id: "capabilities") {
            CapabilitiesView(model: capabilities).frame(minWidth: 800, minHeight: 560)
        }.defaultSize(width: 960, height: 720)
        MenuBarExtra("gpt-bridge", systemImage: model.isConnected ? "link.circle.fill" : "link.circle") {
            MenuContent(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}
