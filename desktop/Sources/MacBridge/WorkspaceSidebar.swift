import SwiftUI

struct WorkspaceSidebar: View {
    @Bindable var model: AppModel
    @Binding var showingConnectionSettings: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("gpt-bridge", systemImage: "link.circle.fill").font(.title2.bold()).padding(.horizontal)
            Text("本地工作区").foregroundStyle(.secondary).padding(.horizontal)
            List {
                ForEach(model.draft.workspaces) { workspace in
                    Button { model.selectWorkspace(workspace.id) } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "folder.fill").foregroundStyle(.blue)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(workspace.name).lineLimit(2)
                                Text("\(workspace.directoryCount) 个访问目录")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 2)
                            if model.status.running && model.status.activeID == model.draft.id && model.status.activeWorkspaceID == workspace.id {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                    .accessibilityLabel("当前生效")
                            }
                        }
                        .padding(8)
                        .background(model.draft.selectedWorkspaceID == workspace.id ? Color.accentColor.opacity(0.1) : .clear,
                                    in: .rect(cornerRadius: 8))
                        .contentShape(.rect)
                    }.buttonStyle(.plain).help(workspace.root)
                }
            }
            Button("添加工作区", systemImage: "plus", action: model.addWorkspace).padding(.horizontal)
            Spacer(minLength: 8)
            Divider()
            Button("连接与设置…", systemImage: "gearshape", action: showSettings).padding(.horizontal)
            Text(model.draft.name).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
            Text("个人预览版 · 0.10").font(.caption).foregroundStyle(.secondary).padding()
        }.padding(.top, 20).disabled(model.busy)
    }

    private func showSettings() { showingConnectionSettings = true }
}
