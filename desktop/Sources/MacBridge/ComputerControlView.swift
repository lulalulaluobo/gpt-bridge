import SwiftUI

struct ComputerControlView: View {
    @Bindable var control: ComputerControl
    var body: some View {
        GroupBox("电脑控制 · 预览") {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label(control.status.enabled ? "已开启 · \(control.status.targetName ?? "应用")" : "已关闭",
                          systemImage: control.status.enabled ? "desktopcomputer" : "pause.circle")
                    Spacer()
                    Button("立即停止", role: .destructive) { Task { await control.stop() } }
                }
                if control.status.enabled, let expires = control.status.expires {
                    Text("授权截止 \(Date(timeIntervalSince1970: expires / 1000).formatted(date: .omitted, time: .shortened))")
                } else {
                    Picker("允许控制的应用", selection: $control.selectedPID) {
                        Text("选择已打开的应用").tag(Int32(0))
                        ForEach(control.applications, id: \.processIdentifier) { app in
                            Text(app.localizedName ?? "应用").tag(app.processIdentifier)
                        }
                    }
                    HStack {
                        Button("刷新应用", action: control.refreshApplications)
                        Spacer()
                        Button("开启 15 分钟") { Task { await control.enable() } }
                            .disabled(control.selectedPID == 0 || control.busy || !control.status.available)
                    }
                }
                Text("允许 ChatGPT 查看所选应用窗口，并输入或点击。文件目录权限不限制界面操作。停止后不会撤销已完成的操作。")
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup("系统权限") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(control.status.permissions ?? []) { permission in
                            Label(permission.title + (permission.granted ? " · 已允许" : " · 未允许"),
                                  systemImage: permission.granted ? "checkmark.circle" : "exclamationmark.circle")
                        }
                        HStack {
                            Button("屏幕录制设置") { control.openPrivacy("Privacy_ScreenCapture") }
                            Button("辅助功能设置") { control.openPrivacy("Privacy_Accessibility") }
                            Button("检查权限") { Task { await control.call("permissions") } }
                        }
                        Text("需要 macOS 15 或更新版本。修改系统权限后，请停止电脑控制并重新开启。")
                    }.padding(.top, 10)
                }
                if let error = control.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            }.padding(10)
        }
        .task {
            control.refreshApplications()
            while !Task.isCancelled {
                await control.call("status")
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
}
