import SwiftUI

struct ConnectionSettings: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("连接与设置").font(.title2.bold())
                Spacer()
                Button("完成", action: close).keyboardShortcut(.cancelAction)
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Menu("切换连接资料") {
                            ForEach(model.connections) { connection in
                                Button(connection.name) { model.select(connection) }
                            }
                        }.disabled(model.connections.isEmpty)
                        Button("添加连接", systemImage: "plus", action: model.newConnection)
                        if LegacyImport.available {
                            Button("导入已有部署", systemImage: "square.and.arrow.down", action: model.importLegacy)
                        }
                    }
                    ConnectionForm(model: model)
                    GeneralSettings(model: model)
                    ChatGPTGuide(model: model)
                }
            }
        }.padding(24).frame(minWidth: 620, idealWidth: 680, minHeight: 580, idealHeight: 700)
    }
    private func close() { dismiss() }
}
