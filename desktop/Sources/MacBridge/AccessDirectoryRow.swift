import SwiftUI

struct AccessDirectoryRow: View {
    @Binding var directory: AccessDirectory
    let replace: () -> Void
    let remove: () -> Void
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "folder").font(.title2).foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 6) {
                Text(directory.name).font(.headline)
                Text(directory.path).foregroundStyle(.secondary).lineLimit(2)
                    .truncationMode(.middle).textSelection(.enabled).help(directory.path)
            }.frame(maxWidth: .infinity, alignment: .leading)
            DirectoryPermissionPicker(access: $directory.access).labelsHidden().frame(width: 140)
                .accessibilityLabel("\(directory.name) 权限")
            Menu {
                Button("更换文件夹…", action: replace)
                Button("移除目录", role: .destructive, action: remove)
            } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("\(directory.name) 操作")
        }.padding(20)
    }
}
