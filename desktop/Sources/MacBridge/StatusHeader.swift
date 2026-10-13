import SwiftUI

struct StatusHeader: View {
    @Bindable var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Label(model.title, systemImage: model.isConnected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(model.isConnected ? .green : .secondary)
                if let name = model.activeWorkspaceName, model.status.running {
                    Text("·").foregroundStyle(.tertiary)
                    Text(name).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                else {
                    Button("刷新状态", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                        .labelStyle(.iconOnly).buttonStyle(.borderless).help("刷新状态")
                }
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled)
            }
        }
    }
}
