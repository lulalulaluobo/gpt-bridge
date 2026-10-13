import SwiftUI
import ServiceManagement

@MainActor @Observable
final class AppModel {
    var configuration = AppConfiguration()
    var status = RuntimeStatus()
    var draft = Connection()
    var sharedDirectories: [AccessDirectory] = []
    var secret = ""
    var message = "填写连接信息，或导入这台 Mac 的已有部署。"
    var error: String?
    var busy = false
    var loginEnabled = false
    var loginNeedsApproval = false
    var configurationLoaded = false
    private var wantsConnection = false
    private var retryCount = 0
    private var nextRetry = Date.distantPast
    private let store: ConfigurationStore
    private let credentials = CredentialStore()
    private let runtime: any RuntimeManaging
    let computerControl: ComputerControl
    private var appliedConnection: Connection?
    var connections: [Connection] { configuration.connections }
    var selected: Connection? { connections.first { $0.id == configuration.selectedID } }
    var isConnected: Bool { status.running && status.healthy && status.ready }
    var title: String { busy ? "正在处理…" : status.title }
    var draftWorkspace: LocalWorkspace {
        get { draft.selectedWorkspace ?? draft.workspaces.first ?? LocalWorkspace(id: draft.id) }
        set {
            if let index = draft.workspaces.firstIndex(where: { $0.id == newValue.id }) {
                draft.workspaces[index] = newValue
            }
        }
    }
    var hasUnsavedChanges: Bool {
        draft != connections.first { $0.id == draft.id } || !secret.isEmpty || sharedDirectories != configuration.sharedDirectories
    }
    var effectiveDraftWorkspace: LocalWorkspace {
        AppConfiguration.applying(sharedDirectories, to: draft).selectedWorkspace ?? draftWorkspace
    }
    var rootReadOnlyByShared: Bool {
        var connection = draft
        if let index = connection.workspaces.firstIndex(where: { $0.id == draftWorkspace.id }) {
            connection.workspaces[index].rootAccess = .readWrite
        }
        return AppConfiguration.applying(sharedDirectories, to: connection).selectedWorkspace?.rootAccess == .readOnly
    }
    var workspaceIsApplied: Bool {
        status.running && status.activeID == draft.id && status.activeWorkspace == effectiveDraftWorkspace
    }
    var activeWorkspaceName: String? {
        status.activeWorkspace?.name ?? status.activeWorkspaceRoot.map { URL(filePath: $0).lastPathComponent }
    }

    init(store: ConfigurationStore = ConfigurationStore(), resources: URL? = nil, monitor: Bool = true,
         runtime: (any RuntimeManaging)? = nil) {
        self.store = store
        self.computerControl = ComputerControl(root: store.root, resources: resources ?? Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        self.runtime = runtime ?? RuntimeClient(root: store.root, resources: resources ?? Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        do {
            configuration = try store.load()
            sharedDirectories = configuration.sharedDirectories
            configurationLoaded = true
            if let selected { draft = selected }
        } catch { self.error = "读取配置失败，原文件已保留：\(error.localizedDescription)" }
        refreshLogin()
        AppDelegate.model = self
        if monitor { Task { await self.launch() } }
    }

    func launch() async {
        // Screen control is always an explicit local session, never a login preference.
        await computerControl.stop()
        await refresh()
        wantsConnection = isConnected && !configuration.manuallyDisconnected
        if ProcessInfo.processInfo.arguments.contains("--resume-after-upgrade"), let connection = selected {
            await startConnection(AppConfiguration.applying(configuration.sharedDirectories, to: connection), preservingStartupPreferences: true)
        } else if configuration.connectOnLaunch && !configuration.manuallyDisconnected && selected != nil {
            await connect()
        }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled else { return }
            await refresh()
            if wantsConnection && !status.running && status.legacyRunning != true && !busy && Date.now >= nextRetry {
                if retryCount < 3 {
                    retryCount += 1
                    nextRetry = .now.addingTimeInterval(Double(15 * (1 << retryCount)))
                    await connect(automatic: true)
                } else {
                    wantsConnection = false
                    error = "自动恢复已尝试 3 次。请检查网络与密钥，再点击连接。"
                }
            }
        }
    }

    func refresh() async {
        guard !busy else { return }
        do {
            status = try await runtime.call("status", connection: nil, key: nil)
            if appliedConnection == nil, let workspace = status.activeWorkspace,
               var connection = connections.first(where: { $0.id == status.activeID }) {
                if let index = connection.workspaces.firstIndex(where: { $0.id == workspace.id }) {
                    connection.workspaces[index] = workspace
                } else { connection.workspaces.append(workspace) }
                connection.selectedWorkspaceID = workspace.id
                appliedConnection = connection
            }
        }
        catch { self.error = error.localizedDescription }
    }

    func select(_ connection: Connection) {
        guard !busy else { return }
        draft = connection; secret = ""
        // Selection is only an editor selection; connecting performs the actual switch.
    }

    func newConnection() { draft = Connection(); secret = ""; message = "新建连接资料，保存后可连接。" }

    func saveDraft() throws -> Connection {
        guard configurationLoaded else { throw AppFailure("现有配置读取失败。请先处理诊断，不覆盖原配置。") }
        let connection = try draft.validated()
        if configuration.connections.contains(where: { $0.id != connection.id && $0.tunnelID == connection.tunnelID }) {
            throw AppFailure("此 Tunnel ID 已保存，请编辑已有连接。")
        }
        if status.running && status.activeID == connection.id,
           (!secret.isEmpty || connections.first(where: { $0.id == connection.id })?.tunnelID != connection.tunnelID) {
            throw AppFailure("请先断开此连接，再修改隧道或密钥；工作区设置可先保存，再应用。")
        }
        if !secret.isEmpty { try credentials.save(secret, id: connection.id) }
        else { _ = try credentials.read(connection.id) }
        var updated = configuration
        updated.sharedDirectories = try AppConfiguration.normalizedDirectories(sharedDirectories)
        if let index = updated.connections.firstIndex(where: { $0.id == connection.id }) { updated.connections[index] = connection }
        else { updated.connections.append(connection) }
        updated.selectedID = connection.id
        try store.save(updated)
        configuration = updated; draft = connection; secret = ""; sharedDirectories = updated.sharedDirectories
        message = "设置已保存。点击“应用并连接”后才更新当前生效的工作区与权限。"
        return connection
    }

    func save() { do { _ = try saveDraft(); error = nil } catch { self.error = error.localizedDescription } }

    func saveAndConnect() async {
        do { _ = try saveDraft() } catch { self.error = error.localizedDescription; return }
        await connect()
    }

    func connect(automatic: Bool = false) async {
        guard let saved = selected else { return }
        let connection = automatic ? appliedConnection ?? AppConfiguration.applying(configuration.sharedDirectories, to: saved)
            : AppConfiguration.applying(configuration.sharedDirectories, to: saved)
        await startConnection(connection, automatic: automatic)
    }

    private func startConnection(_ connection: Connection, automatic: Bool = false,
                                 preservingStartupPreferences: Bool = false) async {
        guard !busy else { return }
        if status.running, let tasks = status.activeTasks, tasks > 0,
           (status.activeID != connection.id || status.activeWorkspace != connection.selectedWorkspace) {
            error = "有 \(tasks) 个活动任务。请完成或取消任务，再应用工作区。"
            return
        }
        busy = true; error = nil
        defer { busy = false }
        do {
            let key = try credentials.read(connection.id)
            status = try await runtime.call("start", connection: connection, key: key)
            var updated = configuration
            if let index = updated.connections.firstIndex(where: { $0.id == connection.id }) {
                updated.connections[index].selectedWorkspaceID = connection.selectedWorkspaceID
            }
            updated.selectedID = connection.id
            if !preservingStartupPreferences { updated.manuallyDisconnected = false }
            try store.save(updated)
            configuration = updated
            appliedConnection = connection
            wantsConnection = true
            if !automatic { retryCount = 0 }
            message = "工作区已生效。可在 ChatGPT 继续使用当前隧道的插件；新增工具时刷新工具列表。"
        } catch {
            self.error = error.localizedDescription
            // Failed credentials / readiness must be handled explicitly, never retry startup blindly.
            wantsConnection = false
        }
    }

    func disconnect() async {
        await computerControl.stop()
        guard !busy else { return }
        busy = true; wantsConnection = false
        defer { busy = false }
        do {
            if configurationLoaded {
                configuration.manuallyDisconnected = true
                try store.save(configuration)
            }
            status = try await runtime.call("stop", connection: nil, key: nil)
            message = "已断开。点击连接前不会自动恢复。"; error = nil
        } catch { self.error = error.localizedDescription }
    }

    func restart() async { await disconnect(); if error == nil { await connect() } }

    func importLegacy() {
        do {
            let (connection, key) = try LegacyImport.read()
            if let existing = connections.first(where: { $0.tunnelID == connection.tunnelID }) {
                select(existing); message = "已有相同隧道配置。"; return
            }
            draft = connection; secret = key
            _ = try saveDraft()
            message = "已导入。点击连接时会先停止旧服务；旧文件保留以便回退。"
        } catch { secret = ""; self.error = error.localizedDescription }
    }

    func chooseFolder() {
        guard let url = selectFolder(title: "选择主工作目录", current: draftWorkspace.root) else { return }
        draftWorkspace.root = url.path
    }

    func addWorkspace() {
        guard let url = selectFolder(title: "添加本地工作区") else { return }
        let workspace = LocalWorkspace(root: url.path)
        draft.workspaces.append(workspace)
        draft.selectedWorkspaceID = workspace.id
        message = "工作区名称来自文件夹名称。保存后可应用，命令执行默认关闭。"
    }

    func selectWorkspace(_ id: String) {
        guard !busy, draft.workspaces.contains(where: { $0.id == id }) else { return }
        draft.selectedWorkspaceID = id
    }

    func removeWorkspace() {
        guard draft.workspaces.count > 1 else { error = "连接至少需要保留一个工作区。"; return }
        draft.workspaces.removeAll { $0.id == draft.selectedWorkspaceID }
        draft.selectedWorkspaceID = draft.workspaces.first?.id
    }

    func addAccessDirectory() {
        guard let url = selectFolder(title: "添加共用目录") else { return }
        let path = url.resolvingSymlinksInPath().path
        guard !sharedDirectories.contains(where: { $0.path == path }) else { error = "此目录已添加。"; return }
        sharedDirectories.append(AccessDirectory(path: path))
    }

    func replaceAccessDirectory(_ id: String) {
        guard let index = sharedDirectories.firstIndex(where: { $0.id == id }),
              let url = selectFolder(title: "更换共用目录", current: sharedDirectories[index].path) else { return }
        let path = url.resolvingSymlinksInPath().path
        guard !sharedDirectories.contains(where: { $0.id != id && $0.path == path }) else { error = "此目录已添加。"; return }
        sharedDirectories[index].path = path
    }

    func removeAccessDirectory(_ id: String) { sharedDirectories.removeAll { $0.id == id } }

    private func selectFolder(title: String, current: String? = nil) -> URL? {
        let panel = NSOpenPanel()
        panel.title = title; panel.prompt = "选择文件夹"
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.canCreateDirectories = true; panel.allowsMultipleSelection = false
        if let current { panel.directoryURL = URL(filePath: current) }
        return panel.runModal() == .OK ? panel.url : nil
    }

    func activateSavedWorkspace(_ id: String) async {
        guard !busy, var connection = selected, connection.workspaces.contains(where: { $0.id == id }) else { return }
        connection.selectedWorkspaceID = id
        await startConnection(AppConfiguration.applying(configuration.sharedDirectories, to: connection))
        if error == nil, draft.id == connection.id { draft.selectedWorkspaceID = id }
    }

    func refreshTasks() async {
        guard !busy else { return }
        do { status = try await runtime.call("tasks", connection: nil, key: nil); error = nil }
        catch { self.error = error.localizedDescription }
    }

    func setConnectOnLaunch(_ enabled: Bool) {
        do {
            guard configurationLoaded else { throw AppFailure("配置读取失败，无法保存启动偏好。") }
            var updated = configuration; updated.connectOnLaunch = enabled
            try store.save(updated); configuration = updated
        } catch { self.error = error.localizedDescription }
    }

    func refreshLogin() {
        loginEnabled = SMAppService.mainApp.status == .enabled
        loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
    }

    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            refreshLogin()
        } catch { self.error = "无法修改登录项：\(error.localizedDescription)"; refreshLogin() }
    }

    func copyTunnel() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(draft.tunnelID, forType: .string)
        message = "Tunnel ID 已复制。"
    }

    func openWorkspace() {
        NSWorkspace.shared.open(URL(filePath: status.activeWorkspaceRoot ?? draftWorkspace.root))
    }

    func exportDiagnostics() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "gpt-bridge-diagnostics.json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            // Only typed runtime state is exported, never native logs or credentials.
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(status).write(to: url, options: .atomic)
            message = "已导出运行状态，不含密钥或原始日志。"
        } catch { self.error = error.localizedDescription }
    }

    func quit() async {
        await disconnect()
        if error == nil { NSApp.terminate(nil) }
    }

    func shutdown() async -> Bool {
        await computerControl.stop()
        guard !busy else { return false }
        busy = true; wantsConnection = false
        defer { busy = false }
        do {
            status = try await runtime.call("stop", connection: nil, key: nil)
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}
