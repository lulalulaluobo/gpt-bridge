import SwiftUI

struct WorkspaceActions: View {
    @Bindable var model: AppModel
    @State private var showingConfirmation = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.hasUnsavedChanges ? "有未保存的修改。保存不会影响当前正在使用的工作区。" : "设置已保存；应用后才改变当前工作区与访问权限。")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("保存设置", action: model.save)
                Button("应用并连接", action: confirm).buttonStyle(.borderedProminent)
                Spacer()
                Button("断开连接", action: disconnect).disabled(!model.status.running)
            }
        }
        .sheet(isPresented: $showingConfirmation) {
            WorkspaceActivationConfirmation(workspace: model.draftWorkspace,
                                            hasUnsavedChanges: model.hasUnsavedChanges,
                                            activeTasks: model.status.activeTasks, apply: apply)
        }
    }
    private func confirm() { showingConfirmation = true }
    private func apply() { Task { await model.saveAndConnect() } }
    private func disconnect() { Task { await model.disconnect() } }
}
