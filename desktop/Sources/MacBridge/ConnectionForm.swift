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
                HStack {
                    Button("保存", action: model.save)
                    Button("应用并连接", action: confirm).buttonStyle(.borderedProminent)
                    Spacer()
                    Button("断开") { Task { await model.disconnect() } }
                }
            }.textFieldStyle(.roundedBorder).padding(10).disabled(model.busy)
        }
        .sheet(isPresented: $showingConfirmation) {
            WorkspaceActivationConfirmation(workspace: model.effectiveDraftWorkspace,
                                            hasUnsavedChanges: model.hasUnsavedChanges,
                                            activeTasks: model.status.activeTasks, apply: apply)
        }
    }
    private func confirm() { showingConfirmation = true }
    private func apply() { Task { await model.saveAndConnect() } }
}
