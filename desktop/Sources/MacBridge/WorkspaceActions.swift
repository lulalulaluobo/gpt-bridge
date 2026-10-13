import SwiftUI

struct WorkspaceActions: View {
    @Bindable var model: AppModel
    @State private var showingConfirmation = false
    var body: some View {
        HStack(spacing: 12) {
            Text(model.hasUnsavedChanges ? "未保存" : model.workspaceIsApplied ? "已应用" : "待应用")
                .foregroundStyle(.secondary)
            Spacer()
            Button("保存", action: model.save).disabled(!model.hasUnsavedChanges)
            Button(model.workspaceIsApplied ? "应用修改" : "应用并连接") { showingConfirmation = true }
                .buttonStyle(.borderedProminent).disabled(model.workspaceIsApplied && !model.hasUnsavedChanges)
        }.disabled(model.busy)
        .sheet(isPresented: $showingConfirmation) {
            WorkspaceActivationConfirmation(workspace: model.effectiveDraftWorkspace,
                                            hasUnsavedChanges: model.hasUnsavedChanges,
                                            activeTasks: model.status.activeTasks) {
                Task { await model.saveAndConnect() }
            }
        }
    }
}
