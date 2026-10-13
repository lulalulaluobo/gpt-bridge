import Foundation

struct RuntimeStatus: Codable, Equatable, Sendable {
    var running = false
    var healthy = false
    var ready = false
    var pid: Int?
    var activeID: String?
    var activeWorkspaceID: String?
    var activeWorkspaceRoot: String?
    var activeWorkspace: LocalWorkspace?
    var activeWorkspaceFingerprint: String?
    var allowCommands: Bool?
    var activeTasks: Int?
    var legacyRunning: Bool? = false
    var error: String?
    var title: String {
        if legacyRunning == true { return "现有脚本服务运行中" }
        if running && healthy && ready { return "已连接" }
        if running { return "连接需要处理" }
        return "已断开"
    }
}
