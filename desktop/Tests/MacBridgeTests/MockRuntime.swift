import Foundation
@testable import MacBridge

actor MockRuntime: RuntimeManaging {
    private var status = RuntimeStatus()
    private(set) var startCount = 0
    private var rejectSwitch = false

    func setRejectSwitch(_ value: Bool) { rejectSwitch = value }

    func call(_ action: String, connection: Connection?, key: String?) async throws -> RuntimeStatus {
        if action == "start", let connection, let workspace = connection.selectedWorkspace {
            if rejectSwitch { throw AppFailure("有活动任务，不能切换工作区。") }
            startCount += 1
            status = RuntimeStatus(running: true, healthy: true, ready: true,
                                   activeID: connection.id, activeWorkspaceID: workspace.id,
                                   activeWorkspaceRoot: workspace.root, activeWorkspace: workspace,
                                   allowCommands: workspace.allowCommands, activeTasks: 0)
        } else if action == "stop" { status = RuntimeStatus() }
        return status
    }
}
