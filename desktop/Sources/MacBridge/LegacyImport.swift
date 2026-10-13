import Foundation
import Darwin

struct LegacyImport {
    static var available: Bool {
        FileManager.default.fileExists(atPath: FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".local/share/macbridge/config/tunnel-id").path)
    }

    // Called only by the explicit Import button. Contents never enter diagnostics.
    static func read() throws -> (Connection, String) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let keyURL = home.appending(path: ".config/macbridge/runtime-api-key")
        var info = stat()
        guard lstat(keyURL.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
            throw AppFailure("旧密钥文件的类型、属主或权限不符；请在界面重新填写密钥。")
        }
        let tunnel = try String(contentsOf: home.appending(path: ".local/share/macbridge/config/tunnel-id"), encoding: .utf8)
        let key = try String(contentsOf: keyURL, encoding: .utf8)
        var connection = Connection()
        connection.name = "gpt-bridge（已有部署）"
        connection.workspaces[0].allowCommands = true
        connection.tunnelID = tunnel
        return (try connection.validated(), key)
    }
}
