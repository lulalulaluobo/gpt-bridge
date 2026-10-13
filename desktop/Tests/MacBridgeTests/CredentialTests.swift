import Testing
import Foundation
import Security
@testable import MacBridge

struct CredentialTests {
    @Test func keychainRoundTripAndUpdate() throws {
        let id = "test-" + UUID().uuidString
        defer {
            SecItemDelete([kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "local.macbridge.desktop.runtime",
                           kSecAttrAccount as String: id] as CFDictionary)
        }
        let store = CredentialStore()
        try store.save("synthetic-test-value-one", id: id)
        #expect(try store.read(id) == "synthetic-test-value-one")
        try store.save("synthetic-test-value-two", id: id)
        #expect(try store.read(id) == "synthetic-test-value-two")
    }
}
