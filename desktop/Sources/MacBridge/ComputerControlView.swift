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
                    HStack {
                        Text("控制范围：所有应用")
                        Spacer()
                        Button("开启电脑控制") { Task { await control.enable() } }
                            .disabled(control.busy || !control.status.available)
                    }
                }
                Text("GPT 可按任务打开应用、选择窗口、查看与操作。保持开启直到你停止或断开连接。")
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup("系统权限") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(control.appPermissions) { permission in
                            Label("gpt-bridge · " + permission.title + (permission.granted ? " · 已允许" : " · 未允许"),
                                  systemImage: permission.granted ? "checkmark.circle" : "exclamationmark.circle")
                        }
                        ForEach(control.status.permissions ?? []) { permission in
                            Label("控制后端 · " + permission.title + (permission.granted ? " · 已允许" : " · 未允许"),
                                  systemImage: permission.granted ? "checkmark.circle" : "exclamationmark.circle")
                        }
                        HStack {
                            Button("请求系统权限") { Task { await control.requestPermissions() } }
                            Button("屏幕录制设置") { control.openPrivacy("Privacy_ScreenCapture") }
                            Button("辅助功能设置") { control.openPrivacy("Privacy_Accessibility") }
                            Button("检查权限") { Task { await control.call("permissions") } }
                        }
                        Text("屏幕录制和辅助功能是两项独立权限。修改后请完全退出并重新打开 gpt-bridge。")
                    }.padding(.top, 10)
                }
                if let error = control.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            }.padding(10)
        }
        .task {
            await control.call("permissions")
            while !Task.isCancelled {
                await control.call("status")
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
}
