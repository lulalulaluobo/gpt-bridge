import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingConnectionSettings = false
    var body: some View {
        NavigationSplitView {
            WorkspaceSidebar(model: model, showingConnectionSettings: $showingConnectionSettings)
                .navigationSplitViewColumnWidth(min: 220, ideal: 250)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    StatusHeader(model: model)
                    WorkspaceDetail(model: model)
                }.padding(28)
            }
        }
        .sheet(isPresented: $showingConnectionSettings) { ConnectionSettings(model: model) }
    }
}
