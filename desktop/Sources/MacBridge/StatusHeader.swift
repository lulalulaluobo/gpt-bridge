import SwiftUI

struct StatusHeader: View {
    @Bindable var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("你的 Mac，连接到 ChatGPT").font(.title2.bold())
                    Text(model.title).foregroundStyle(model.isConnected ? .green : .secondary)
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                else { Button("刷新", systemImage: "arrow.clockwise") { Task { await model.refresh() } } }
            }
            Text(model.message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            if let name = model.activeWorkspaceName, model.status.running {
                Label("当前生效：\(name)", systemImage: "folder.badge.gearshape")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled)
            }
            if model.status.running {
                Text("进程：运行中 · 健康：\(model.status.healthy ? "通过" : "未通过") · 就绪：\(model.status.ready ? "通过" : "未通过")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
