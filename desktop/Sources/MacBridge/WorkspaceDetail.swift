import SwiftUI

struct WorkspaceDetail: View {
    @Bindable var model: AppModel
    @State private var confirmingRemoval = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text(model.draftWorkspace.name).font(.title.bold()).lineLimit(2)
                Spacer()
                Menu {
                    Button("在 Finder 中显示", systemImage: "folder") {
                        NSWorkspace.shared.open(URL(filePath: model.draftWorkspace.root))
                    }
                    Button("移除工作区", systemImage: "trash", role: .destructive) { confirmingRemoval = true }
                        .disabled(model.draft.workspaces.count < 2)
                } label: { Image(systemName: "ellipsis.circle").font(.title3) }
                .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("工作区操作")
            }
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 16) {
                    Image(systemName: "folder.fill").font(.title).foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("主目录").font(.headline)
                        Text(model.draftWorkspace.root).foregroundStyle(.secondary)
                            .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Button("选择文件夹…", action: model.chooseFolder)
                }
                Divider()
                HStack {
                    Text("文件权限")
                    Spacer()
                    if model.rootReadOnlyByShared {
                        Label("只读 · 共用权限", systemImage: "lock").foregroundStyle(.secondary)
                    } else {
                        DirectoryPermissionPicker(access: $model.draftWorkspace.rootAccess).labelsHidden().frame(width: 160)
                    }
                }
            }.padding(20).background(.background, in: .rect(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 16) {
                Toggle("允许执行命令", isOn: $model.draftWorkspace.allowCommands).toggleStyle(.switch)
                if model.draftWorkspace.allowCommands {
                    Label("命令可访问授权目录以外的文件。", systemImage: "exclamationmark.shield").foregroundStyle(.secondary)
                }
                if let tasks = model.status.activeTasks, tasks > 0 {
                    Label("\(tasks) 个任务运行中", systemImage: "hourglass").foregroundStyle(.orange)
                }
            }.padding(20).background(.background, in: .rect(cornerRadius: 12))
        }.disabled(model.busy)
        .confirmationDialog("移除此工作区？文件夹和文件会保留。", isPresented: $confirmingRemoval) {
            Button("移除工作区", role: .destructive, action: model.removeWorkspace)
        }
    }
}
