import Foundation
import Security

struct CredentialStore: Sendable {
    private let service = "local.macbridge.desktop.runtime"

    private func query(_ id: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: id]
    }

    func read(_ id: String) throws -> String {
        var query = query(id)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8), !value.isEmpty else {
            throw AppFailure(status == errSecItemNotFound ? "此连接还没有密钥，请在设置中填写 Runtime API key。" : "无法读取钥匙串（\(status)），请解锁登录钥匙串或重新保存密钥。")
        }
        return value
    }

    func save(_ value: String, id: String) throws {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("\n"), !value.contains("\0") else {
            throw AppFailure("Runtime API key 不能为空或包含换行。")
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        var status = SecItemUpdate(query(id) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(id).merging(attributes) { _, new in new }
            item[kSecAttrLabel as String] = "MacBridge Runtime API key"
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw AppFailure("保存到钥匙串失败（\(status)）。") }
    }
}
