import SwiftUI

struct CapabilityEntry: Codable, Identifiable, Sendable {
    let id: String
    let kind: String
    let name: String
    let description: String
    let path: String
}

struct CapabilityCatalog: Codable, Sendable {
    let revision: String
    let indexedAt: String?
    let skillRoots: [String]
    let cliRoots: [String]
    let disabledIDs: [String]
    let entries: [CapabilityEntry]
    let warnings: [String]
    let added: Int
    let updated: Int
    let removed: Int
}

actor CatalogClient {
    func call(_ action: String, input: Data? = nil) throws -> CapabilityCatalog {
        guard let resources = Bundle.main.resourceURL else { throw AppFailure("应用资源不可用。") }
        let process = Process()
        process.executableURL = resources.appending(path: "runtime/bin/node")
        process.arguments = [resources.appending(path: "bridge/catalog-cli.mjs").path,
                             ConfigurationStore().root.path, action]
        process.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                               "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
        let stdin = Pipe(), stdout = Pipe()
        process.standardInput = stdin; process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        try process.run()
        if let input { try stdin.fileHandleForWriting.write(contentsOf: input) }
        try stdin.fileHandleForWriting.close()
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        if let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let message = error["error"] as? String { throw AppFailure(message) }
        guard process.terminationStatus == 0 else { throw AppFailure("索引更新失败，原目录已保留。") }
        return try JSONDecoder().decode(CapabilityCatalog.self, from: data)
    }
}

@MainActor @Observable final class CapabilityModel {
    var catalog: CapabilityCatalog?
    var busy = false
    var error: String?
    var skillRoots: [String] = []
    var cliRoots: [String] = []
    private let client = CatalogClient()

    func perform(_ action: String, values: [String: Any] = [:]) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            var request = values
            request["revision"] = catalog?.revision ?? ""
            let input = action == "read" ? nil : try JSONSerialization.data(withJSONObject: request)
            let result = try await client.call(action, input: input)
            catalog = result; skillRoots = result.skillRoots; cliRoots = result.cliRoots
        } catch { self.error = error.localizedDescription }
    }
    func refresh() async {
        await perform("refresh", values: ["skillRoots": skillRoots, "cliRoots": cliRoots])
    }
    func chooseSource(_ kind: String) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false; panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true; panel.showsHiddenFiles = true
        if panel.runModal() == .OK {
            for url in panel.urls {
                if kind == "skill", !skillRoots.contains(url.path) { skillRoots.append(url.path) }
                if kind == "cli", !cliRoots.contains(url.path) { cliRoots.append(url.path) }
            }
        }
    }
}

struct CapabilitiesView: View {
    @Bindable var model: CapabilityModel
    @State private var kind = "skill"
    @State private var query = ""
    @State private var sources = false
    private var entries: [CapabilityEntry] {
        (model.catalog?.entries ?? []).filter {
            $0.kind == kind && (query.isEmpty || ($0.name + " " + $0.description).localizedCaseInsensitiveContains(query))
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("技能与 CLI").font(.title2.bold())
                    Text(model.catalog?.indexedAt == nil ? "选择来源后，建立本机能力目录" : "网页 GPT 与此列表使用同一份索引")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("索引来源…") { sources = true }
                Button { Task { await model.refresh() } } label: {
                    Label(model.busy ? "正在更新" : "重新索引", systemImage: "arrow.clockwise")
                }.buttonStyle(.borderedProminent)
            }.padding(24)
            HStack {
                Picker("类型", selection: $kind) {
                    Text("Skills").tag("skill"); Text("CLI").tag("cli")
                }.pickerStyle(.segmented).frame(width: 220)
                Spacer()
                TextField("搜索名称或用途", text: $query).textFieldStyle(.roundedBorder).frame(width: 250)
            }.padding(.horizontal, 24).padding(.bottom, 16)
            Divider()
            if let error = model.error { Text(error).foregroundStyle(.red).textSelection(.enabled).padding() }
            List(entries) { entry in
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: kind == "skill" ? "book.closed" : "terminal").font(.title2).foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.name).font(.headline)
                        Text(entry.description).foregroundStyle(.secondary).lineLimit(3)
                        DisclosureGroup(kind == "skill" ? "已索引 · 查看来源" : "已发现，未验证 · 查看路径") {
                            Text(entry.path).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                        }.foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("向 GPT 提供", isOn: Binding(get: {
                        !(model.catalog?.disabledIDs.contains(entry.id) ?? false)
                    }, set: { enabled in
                        Task { await model.perform("toggle", values: ["id": entry.id, "enabled": enabled]) }
                    })).toggleStyle(.checkbox)
                }.padding(.vertical, 10)
            }.overlay {
                if entries.isEmpty { ContentUnavailableView("暂无匹配项", systemImage: "books.vertical", description: Text("调整搜索，或选择来源并重新索引。")) }
            }
            Divider()
            HStack {
                if let catalog = model.catalog, let date = catalog.indexedAt {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(catalog.entries.count) 项 · 新增 \(catalog.added) · 更新 \(catalog.updated) · 移除 \(catalog.removed)")
                        Text("上次索引：\(date)").foregroundStyle(.secondary)
                    }
                } else { Text("尚未建立索引").foregroundStyle(.secondary) }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
            }.padding(20)
        }.disabled(model.busy)
        .task { await model.perform("read") }
        .sheet(isPresented: $sources) {
            VStack(alignment: .leading, spacing: 18) {
                Text("索引来源").font(.title2.bold())
                Text("只扫描所选位置。索引会读取 Skill 说明，不会执行 CLI。")
                sourceList("Skills 文件夹", kind: "skill", paths: model.skillRoots)
                sourceList("CLI 所在文件夹", kind: "cli", paths: model.cliRoots)
                if let warnings = model.catalog?.warnings, !warnings.isEmpty {
                    DisclosureGroup("\(warnings.count) 条索引提示") {
                        ScrollView { Text(warnings.joined(separator: "\n")).textSelection(.enabled) }.frame(maxHeight: 100)
                    }
                }
                HStack {
                    Spacer()
                    Button("取消") {
                        model.skillRoots = model.catalog?.skillRoots ?? []
                        model.cliRoots = model.catalog?.cliRoots ?? []; sources = false
                    }
                    Button("保存并重新索引") { sources = false; Task { await model.refresh() } }.buttonStyle(.borderedProminent)
                }
            }.padding(24).frame(width: 660)
        }
    }
    private func sourceList(_ title: String, kind: String, paths: [String]) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 10) {
                ScrollView {
                    ForEach(paths, id: \.self) { path in
                        HStack {
                            Text(path).lineLimit(2).textSelection(.enabled)
                            Spacer()
                            Button("移除", systemImage: "minus.circle") {
                                if kind == "skill" { model.skillRoots.removeAll { $0 == path } }
                                else { model.cliRoots.removeAll { $0 == path } }
                            }.labelStyle(.iconOnly)
                        }
                    }
                }.frame(height: 110)
                Button("添加文件夹…", systemImage: "plus") { model.chooseSource(kind) }
            }.padding(8)
        }
    }
}
