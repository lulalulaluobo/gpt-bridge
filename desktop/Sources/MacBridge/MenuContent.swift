import SwiftUI

struct MenuContent: View {
    @Bindable var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var pendingWorkspace: LocalWorkspace?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("gpt-bridge", systemImage: "link").font(.headline)
            Label(model.title, systemImage: model.isConnected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(model.isConnected ? .green : .secondary)
            Text(model.selected?.name ?? "尚未配置连接").foregroundStyle(.secondary)
            if let error = model.error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("连接") { Task { await model.connect() } }.disabled(model.selected == nil || model.busy || model.isConnected)
                Button("断开") { Task { await model.disconnect() } }.disabled(model.busy)
                Button("重启") { Task { await model.restart() } }.disabled(model.busy || model.selected == nil)
            }
            Divider()
            Button("立即停止电脑控制", systemImage: "stop.circle", role: .destructive) {
                Task { await model.computerControl.stop() }
            }
            if let connection = model.selected {
                Text("切换工作区").font(.caption).foregroundStyle(.secondary)
                ForEach(connection.workspaces) { workspace in
                    Button {
                        pendingWorkspace = AppConfiguration.applying(model.configuration.sharedDirectories, to: connection)
                            .workspaces.first { $0.id == workspace.id }
                    } label: {
                        Label(workspace.name,
                              systemImage: model.status.activeWorkspaceID == workspace.id && model.status.running ? "checkmark.circle.fill" : "folder")
                    }.disabled(model.busy).help(workspace.root)
                }
                Divider()
            }
            Button("连接与设置…", systemImage: "gearshape") {
                openWindow(id: "settings"); NSApp.activate(ignoringOtherApps: true)
            }
            Button("打开工作文件夹", systemImage: "folder", action: model.openWorkspace).disabled(model.selected == nil)
            Button("断开并退出 gpt-bridge") { Task { await model.quit() } }.disabled(model.busy)
        }.padding(20).frame(width: 330)
        .sheet(item: $pendingWorkspace) { workspace in
            WorkspaceActivationConfirmation(workspace: workspace, hasUnsavedChanges: false,
                                            activeTasks: model.status.activeTasks) {
                Task { await model.activateSavedWorkspace(workspace.id) }
            }
        }
    }
}
