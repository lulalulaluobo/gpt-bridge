import SwiftUI

struct DirectoryScopeSummary: View {
    let path: String
    let access: DirectoryAccess
    let isRoot: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Label(URL(filePath: path).lastPathComponent, systemImage: "folder")
                if isRoot { Text("主目录").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text(access.title).font(.callout.bold())
            }
            Text(path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
        }.padding(12).background(.quaternary, in: .rect(cornerRadius: 8))
    }
}
