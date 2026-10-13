import AppKit

final class TunnelProbe: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let field = NSTextField(string: "")
    let result = NSTextField(labelWithString: "等待网页验证")
    let code = ProcessInfo.processInfo.environment["CU_VISUAL_CODE"] ?? "NOT-SET"
    let resultPath = ProcessInfo.processInfo.environment["CU_RESULT_PATH"]!
    var count = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 700, height: 360), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "GPT Bridge Tunnel CU Test"
        let title = NSTextField(labelWithString: "ChatGPT → Tunnel → 测试窗口")
        title.font = .systemFont(ofSize: 23, weight: .semibold)
        title.frame = NSRect(x: 30, y: 295, width: 640, height: 35)
        let challenge = NSTextField(labelWithString: "屏幕验证码：\(code)")
        challenge.font = .monospacedSystemFont(ofSize: 26, weight: .bold)
        challenge.frame = NSRect(x: 30, y: 230, width: 640, height: 42)
        field.placeholderString = "请由网页模型根据截图输入验证码"
        field.setAccessibilityIdentifier("probe-input")
        field.frame = NSRect(x: 30, y: 160, width: 620, height: 38)
        let button = NSButton(title: "验证点击", target: self, action: #selector(clicked))
        button.bezelStyle = .rounded
        button.frame = NSRect(x: 30, y: 90, width: 160, height: 42)
        result.frame = NSRect(x: 30, y: 25, width: 640, height: 46)
        result.font = .systemFont(ofSize: 20, weight: .medium)
        for view in [title, challenge, field, button, result] { window.contentView!.addSubview(view) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if let ready = ProcessInfo.processInfo.environment["CU_READY_PATH"] { try? Data("ready".utf8).write(to: URL(fileURLWithPath: ready), options: .atomic) }
    }
    @objc func clicked() {
        count += 1
        let passed = field.stringValue == code && count == 1
        result.stringValue = "\(passed ? "验证通过" : "验证失败") · 点击 \(count) 次 · \(field.stringValue)"
        let record: [String: Any] = ["passed": passed, "clickCount": count, "input": field.stringValue, "expected": code, "pid": ProcessInfo.processInfo.processIdentifier, "at": ISO8601DateFormatter().string(from: Date())]
        if let data = try? JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: resultPath), options: .atomic) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = TunnelProbe()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
