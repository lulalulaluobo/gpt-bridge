import SwiftUI

struct WorkspaceActivationConfirmation: View {
    let workspace: LocalWorkspace
    let hasUnsavedChanges: Bool
    let activeTasks: Int?
    let apply: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("应用 \(workspace.name)？").font(.title2.bold())
            Text("将应用主目录与共用目录权限。")
                .foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DirectoryScopeSummary(path: workspace.root, access: workspace.rootAccess, isRoot: true)
                    ForEach(workspace.directories) { directory in
                        DirectoryScopeSummary(path: directory.path, access: directory.access, isRoot: false)
                    }
                }
            }.frame(maxHeight: 260)
            Label(workspace.allowCommands ? "命令执行：开启" : "命令执行：关闭",
                  systemImage: workspace.allowCommands ? "terminal" : "lock")
            if workspace.allowCommands {
                Text("命令以当前 Mac 用户权限运行，可访问上述目录范围以外的文件。文件权限不约束命令。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if hasUnsavedChanges {
                Text("此操作会先保存未保存的修改，再应用工作区。").font(.caption).foregroundStyle(.secondary)
            }
            if let activeTasks, activeTasks > 0 {
                Label("当前有 \(activeTasks) 个活动任务；切换前须完成或取消。", systemImage: "hourglass")
                    .foregroundStyle(.orange)
            }
            HStack {
                Spacer()
                Button("取消", action: cancel).keyboardShortcut(.cancelAction)
                Button("应用工作区", action: confirm).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 560)
    }

    private func cancel() { dismiss() }
    private func confirm() { dismiss(); apply() }
}
