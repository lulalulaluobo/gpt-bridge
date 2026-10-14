import SwiftUI

struct WorkspaceSidebar: View {
    @Bindable var model: AppModel
    @Binding var showingConnectionSettings: Bool
    @Binding var showingSharedDirectories: Bool
    var body: some View {
        VStack(spacing: 0) {
            List {
                Section("工作区") {
                    ForEach(model.draft.workspaces) { workspace in
                        Button {
                            model.selectWorkspace(workspace.id); showingSharedDirectories = false
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "folder").foregroundStyle(.blue)
                                Text(workspace.name).lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: 2)
                                if model.status.running && model.status.activeID == model.draft.id && model.status.activeWorkspaceID == workspace.id {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("当前生效")
                                }
                            }.padding(.vertical, 9).padding(.horizontal, 8)
                                .background(!showingSharedDirectories && model.draft.selectedWorkspaceID == workspace.id
                                            ? Color.accentColor.opacity(0.12) : .clear, in: .rect(cornerRadius: 8))
                                .contentShape(.rect)
                        }.buttonStyle(.plain).help(workspace.root)
                    }
                    Button("添加工作区…", systemImage: "plus") {
                        model.addWorkspace(); showingSharedDirectories = false
                    }.padding(.vertical, 8)
                }
                Section("权限") {
                    Button { showingSharedDirectories = true } label: {
                        HStack {
                            Label("共用目录", systemImage: "folder.badge.person.crop")
                            Spacer()
                            Text("\(model.sharedDirectories.count)").foregroundStyle(.secondary)
                        }.padding(.vertical, 9).padding(.horizontal, 8)
                            .background(showingSharedDirectories ? Color.accentColor.opacity(0.12) : .clear,
                                        in: .rect(cornerRadius: 8)).contentShape(.rect)
                    }.buttonStyle(.plain)
                }
            }.listStyle(.sidebar)
            Divider()
            Button("连接与设置", systemImage: "gearshape") { showingConnectionSettings = true }
                .buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }.disabled(model.busy)
    }
}
