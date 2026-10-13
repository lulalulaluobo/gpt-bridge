import Foundation

actor RuntimeClient: RuntimeManaging {
    let root: URL
    let resources: URL
    init(root: URL, resources: URL) { self.root = root; self.resources = resources }

    func call(_ action: String, connection: Connection? = nil, key: String? = nil) throws -> RuntimeStatus {
        let process = Process()
        process.executableURL = resources.appending(path: "runtime/bin/node")
        process.arguments = [resources.appending(path: "bridge/control.mjs").path, action, root.path]
        var environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                           "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        if let key { environment["MACBRIDGE_RUNTIME_KEY"] = key }
        process.environment = environment
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        // Native manager diagnostics are normalized by the bridge, never expose raw stderr.
        process.standardError = FileHandle.nullDevice
        try process.run()
        if let connection { try input.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(connection)) }
        try input.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard let response = try? JSONDecoder().decode(RuntimeStatus.self, from: data) else {
            throw AppFailure("运行器未返回有效状态（\(process.terminationStatus)）。请使用应用内诊断或重新安装完整应用。")
        }
        if let error = response.error { throw AppFailure(error) }
        guard process.terminationStatus == 0 else { throw AppFailure("运行器操作失败。") }
        return response
    }
}
