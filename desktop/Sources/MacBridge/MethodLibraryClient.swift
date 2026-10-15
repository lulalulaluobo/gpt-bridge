import Foundation

actor MethodLibraryClient {
    let root: URL
    let resources: URL
    init(root: URL, resources: URL) { self.root = root; self.resources = resources }

    func query(_ input: Data) throws -> Data {
        let process = Process(), output = Pipe(), stdin = Pipe()
        process.executableURL = resources.appending(path: "runtime/bin/node")
        process.arguments = [resources.appending(path: "bridge/method-library-cli.mjs").path, root.path]
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        process.standardInput = stdin; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run()
        try stdin.fileHandleForWriting.write(contentsOf: input)
        try stdin.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        if let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let error = response["error"] as? String {
            throw AppFailure(error)
        }
        guard process.terminationStatus == 0 else { throw AppFailure("方法库读取失败。") }
        return data
    }
}
