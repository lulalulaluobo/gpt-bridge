import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Observation

@MainActor @Observable
final class ComputerControl {
    var status = ComputerControlStatus()
    var applications: [NSRunningApplication] = []
    var selectedPID: Int32 = 0
    var busy = false
    var error: String?
    var appPermissions: [ComputerControlStatus.Permission] = []
    private let root: URL
    private let resources: URL
    private var revision = 0

    init(root: URL, resources: URL) { self.root = root; self.resources = resources }

    func refreshApplications() {
        applications = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
        }.sorted { ($0.localizedName ?? "") < ($1.localizedName ?? "") }
        if !applications.contains(where: { $0.processIdentifier == selectedPID }) { selectedPID = 0 }
    }

    func call(_ action: String, payload: Data? = nil) async {
        if action == "permissions" || action == "enable" {
            appPermissions = [
                .init(name: "Screen Recording", granted: CGPreflightScreenCaptureAccess()),
                .init(name: "Accessibility", granted: AXIsProcessTrusted())
            ]
        }
        let root = root, resources = resources
        if action == "enable" || action == "stop" { revision += 1 }
        let startedRevision = revision
        do {
            var requestID: String?
            if action == "enable" || action == "stop" {
                // Record UI intent before scheduling a process. A delayed enable cannot overtake Stop.
                let id = UUID().uuidString
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                        attributes: [.posixPermissions: 0o700])
                let intent = root.appending(path: "computer-intent.json")
                try JSONSerialization.data(withJSONObject: ["id": id]).write(to: intent, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: intent.path)
                requestID = id
            }
            let intentID = requestID
            let response = try await Task.detached(priority: .userInitiated) {
                let process = Process(), input = Pipe(), output = Pipe()
                process.executableURL = resources.appending(path: "runtime/bin/node")
                process.arguments = [resources.appending(path: "bridge/computer-control.mjs").path, action, root.path]
                if let intentID { process.arguments?.append(intentID) }
                process.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                                       "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
                process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
                try process.run()
                if let payload { try input.fileHandleForWriting.write(contentsOf: payload) }
                try input.fileHandleForWriting.close()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                return try JSONDecoder().decode(ComputerControlStatus.self, from: data)
            }.value
            guard startedRevision == revision else { return }
            var updated = response
            if updated.permissions == nil { updated.permissions = status.permissions }
            status = updated
            if action != "status" { error = response.error }
        } catch { self.error = "无法读取电脑控制状态：\(error.localizedDescription)" }
    }

    func enable() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await call("enable")
    }

    func stop() async { await call("stop") }
    func requestPermissions() async {
        _ = CGRequestScreenCaptureAccess()
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        await call("permissions")
    }
    func openPrivacy(_ pane: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
    }
}
