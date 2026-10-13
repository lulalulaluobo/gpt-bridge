import SwiftUI

struct WorkspaceDetail: View {
    @Bindable var model: AppModel
    @State private var confirmingRemoval = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.draftWorkspace.name).font(.title.bold())
                    Label(model.workspaceIsApplied ? "当前生效" : "待应用", systemImage: model.workspaceIsApplied ? "checkmark.circle.fill" : "clock")
                        .foregroundStyle(model.workspaceIsApplied ? .green : .secondary)
                }
                Spacer()
                Button("移除工作区", systemImage: "trash", action: confirmRemoval)
                    .disabled(model.draft.workspaces.count < 2)
            }

            GroupBox("主工作目录") {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top) {
                        Label(model.draftWorkspace.root, systemImage: "folder")
                            .foregroundStyle(.secondary).textSelection(.enabled)
                        Spacer()
                        Button("更换目录…", action: model.chooseFolder)
                    }
                    DirectoryPermissionPicker(access: $model.draftWorkspace.rootAccess)
                    Text("文件夹名称自动作为工作区名称；命令默认在主目录中启动。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(10)
            }

            GroupBox {
                VStack(alignment: .leading, spacing: 14) {
                    if model.draftWorkspace.directories.isEmpty {
                        Text("添加资料库、素材或输出文件夹，让当前工作区访问更多目录。")
                            .foregroundStyle(.secondary).padding(.vertical, 6)
                    }
                    ForEach($model.draftWorkspace.directories) { $directory in
                        AccessDirectoryRow(directory: $directory,
                                           replace: { model.replaceAccessDirectory(directory.id) },
                                           remove: { model.removeAccessDirectory(directory.id) })
                    }
                    Button("添加访问目录…", systemImage: "plus", action: model.addAccessDirectory)
                    Text("新增目录默认只读。目录名称来自路径；重叠目录按更具体的路径匹配权限。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(10)
            } label: { Text("附加访问目录") }

            GroupBox("命令执行") {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("允许当前工作区执行命令", isOn: $model.draftWorkspace.allowCommands)
                    Text(model.draftWorkspace.allowCommands
                         ? "命令以当前 Mac 用户权限运行，可访问目录授权以外的文件。只读/读写规则约束文件工具，不约束命令。"
                         : "命令执行已关闭。仍可使用当前工作区授权的文件读取、搜索与写入工具。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let tasks = model.status.activeTasks, tasks > 0 {
                        Label("有 \(tasks) 个活动任务。完成或取消后才能切换工作区。", systemImage: "hourglass")
                            .foregroundStyle(.orange)
                    }
                    Button("检查活动任务", systemImage: "arrow.clockwise", action: checkTasks)
                        .disabled(!model.status.running)
                }.padding(10)
            }

            WorkspaceActions(model: model)
        }.disabled(model.busy)
        .confirmationDialog("从连接资料移除此工作区？文件夹和文件会保留。", isPresented: $confirmingRemoval) {
            Button("移除工作区", role: .destructive, action: model.removeWorkspace)
        }
    }

    private func confirmRemoval() { confirmingRemoval = true }
    private func checkTasks() { Task { await model.refreshTasks() } }
}
