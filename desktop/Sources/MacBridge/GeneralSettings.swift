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
                Text("关闭此窗口后菜单栏与连接保持运行；主动断开后不会自动重连。电脑需保持开机和联网。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("导出诊断状态…", systemImage: "square.and.arrow.up", action: model.exportDiagnostics)
            }.padding(10).disabled(model.busy)
        }
        .onAppear { connectOnLaunch = model.configuration.connectOnLaunch; loginEnabled = model.loginEnabled }
    }
}
