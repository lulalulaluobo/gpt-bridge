import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static weak var model: AppModel?
    private var terminating = false

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model = Self.model else { return .terminateNow }
        guard !model.busy else {
            model.error = "正在执行连接操作，请完成后再退出。"
            return .terminateCancel
        }
        guard !terminating else { return .terminateLater }
        terminating = true
        Task {
            let stopped = await model.shutdown()
            terminating = false
            sender.reply(toApplicationShouldTerminate: stopped)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
