import Foundation

struct AppConfiguration: Codable, Sendable {
    var schemaVersion = 1
    var connections: [Connection] = []
    var selectedID: String?
    var connectOnLaunch = false
    // Persist an explicit disconnect across application launches.
    var manuallyDisconnected = false
}
