import SwiftUI
import ServiceManagement

struct GeneralSettings: View {
    @Bindable var model: AppModel
    @State private var connectOnLaunch = false
    @State private var loginEnabled = false
    var body: some View {
        GroupBox("后台与诊断") {
            VStack(alignment: .leading, spacing: 12) {
                Toggle("登录 Mac 时启动", isOn: $loginEnabled)
                    .onChange(of: loginEnabled) { _, value in if value != model.loginEnabled { model.setLogin(value); loginEnabled = model.loginEnabled } }
                Toggle("启动应用后自动连接", isOn: $connectOnLaunch)
                    .onChange(of: connectOnLaunch) { _, value in model.setConnectOnLaunch(value) }
                if model.loginNeedsApproval {
                    Button("在系统设置中允许登录项") { SMAppService.openSystemSettingsLoginItems() }
                }
                DisclosureGroup("连接诊断") {
                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent("进程", value: model.status.running ? "运行中" : "已停止")
                        LabeledContent("健康检查", value: model.status.healthy ? "通过" : "未通过")
                        LabeledContent("隧道就绪", value: model.status.ready ? "通过" : "未通过")
                        Button("导出诊断状态…", systemImage: "square.and.arrow.up", action: model.exportDiagnostics)
                    }.padding(.top, 12)
                }
            }.padding(10).disabled(model.busy)
        }
        .onAppear { connectOnLaunch = model.configuration.connectOnLaunch; loginEnabled = model.loginEnabled }
    }
}
