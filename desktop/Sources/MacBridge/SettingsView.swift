import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var showingConnectionSettings = false
    @State private var showingSharedDirectories = false
    @State private var showingMethods = false
    var body: some View {
        NavigationSplitView {
            WorkspaceSidebar(model: model, showingConnectionSettings: $showingConnectionSettings,
                             showingSharedDirectories: $showingSharedDirectories, showingMethods: $showingMethods)
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 300)
        } detail: {
            VStack(spacing: 0) {
                StatusHeader(model: model).padding(.horizontal, 28).padding(.vertical, 16)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        if showingMethods { MethodLibraryView() }
                        else if showingSharedDirectories { SharedDirectoriesView(model: model) }
                        else { WorkspaceDetail(model: model) }
                    }.frame(maxWidth: 820, alignment: .leading).padding(28)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                if !showingMethods {
                    Divider()
                    WorkspaceActions(model: model).padding(.horizontal, 28).padding(.vertical, 16)
                }
            }.background(Color(nsColor: .windowBackgroundColor))
        }
        .sheet(isPresented: $showingConnectionSettings) { ConnectionSettings(model: model) }
    }
}
