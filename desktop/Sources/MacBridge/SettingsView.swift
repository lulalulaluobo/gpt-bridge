import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingConnectionSettings = false
    @State private var showingSharedDirectories = false
    var body: some View {
        NavigationSplitView {
            WorkspaceSidebar(model: model, showingConnectionSettings: $showingConnectionSettings,
                             showingSharedDirectories: $showingSharedDirectories)
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                StatusHeader(model: model).padding(.horizontal, 28).padding(.vertical, 16)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if showingSharedDirectories { SharedDirectoriesView(model: model) }
                        else { WorkspaceDetail(model: model) }
                    }.frame(maxWidth: 820, alignment: .leading).padding(28)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                Divider()
                WorkspaceActions(model: model).padding(.horizontal, 28).padding(.vertical, 16)
            }.background(Color(nsColor: .windowBackgroundColor))
        }
        .sheet(isPresented: $showingConnectionSettings) { ConnectionSettings(model: model) }
    }
}
