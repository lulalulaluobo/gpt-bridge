import SwiftUI

struct AccessDirectoryRow: View {
    @Binding var directory: AccessDirectory
    let replace: () -> Void
    let remove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Label(directory.name, systemImage: "folder").font(.headline)
                    Text(directory.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                Spacer()
                Button("更换文件夹…", action: replace)
                Button("移除 \(directory.name)", systemImage: "trash", role: .destructive, action: remove)
                    .labelStyle(.iconOnly)
            }
            DirectoryPermissionPicker(access: $directory.access)
            Divider()
        }
    }
}
