import AppKit

final class Probe: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let field = NSTextField(string: "")
    let result = NSTextField(labelWithString: "尚未点击")
    var count = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 620, height: 300), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "GPT Bridge CU Probe"
        let title = NSTextField(labelWithString: "Computer Use 独立验证窗口")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.frame = NSRect(x: 30, y: 235, width: 560, height: 35)
        field.placeholderString = "在这里输入验证标识"
        field.setAccessibilityIdentifier("probe-input")
        field.frame = NSRect(x: 30, y: 165, width: 550, height: 36)
        let button = NSButton(title: "验证点击", target: self, action: #selector(clicked))
        button.bezelStyle = .rounded
        button.frame = NSRect(x: 30, y: 95, width: 160, height: 40)
        result.frame = NSRect(x: 30, y: 35, width: 560, height: 40)
        for view in [title, field, button, result] { window.contentView!.addSubview(view) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func clicked() { count += 1; result.stringValue = "点击 \(count) 次；输入：\(field.stringValue)" }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = Probe()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
