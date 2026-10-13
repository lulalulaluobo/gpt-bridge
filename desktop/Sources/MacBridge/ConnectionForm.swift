import SwiftUI

struct ConnectionForm: View {
    @Bindable var model: AppModel
    @State private var showingConfirmation = false
    var body: some View {
        GroupBox("连接资料") {
            VStack(alignment: .leading, spacing: 14) {
                LabeledContent("名称") { TextField("例如：工作 Mac", text: $model.draft.name) }
                LabeledContent("Tunnel ID") { TextField("tunnel_…", text: $model.draft.tunnelID).autocorrectionDisabled() }
                LabeledContent("Runtime API key") { SecureField("新连接必填；已保存时留空保留", text: $model.secret) }
                Text("使用同一组织中具备 Read + Use 权限的 Runtime key。密钥仅保存在本机钥匙串。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("本地工作区与目录权限在主页面管理；切换工作区可复用同一隧道。")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("保存", action: model.save)
                    Button("应用并连接", action: confirm).buttonStyle(.borderedProminent)
                    Spacer()
                    Button("断开") { Task { await model.disconnect() } }
                }
            }.textFieldStyle(.roundedBorder).padding(10).disabled(model.busy)
        }
        .sheet(isPresented: $showingConfirmation) {
            WorkspaceActivationConfirmation(workspace: model.draftWorkspace,
                                            hasUnsavedChanges: model.hasUnsavedChanges,
                                            activeTasks: model.status.activeTasks, apply: apply)
        }
    }
    private func confirm() { showingConfirmation = true }
    private func apply() { Task { await model.saveAndConnect() } }
}
