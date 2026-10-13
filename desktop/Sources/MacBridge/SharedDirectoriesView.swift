import SwiftUI

struct SharedDirectoriesView: View {
    @Bindable var model: AppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                VStack(alignment: .leading, spacing: 8) {
                    Text("共用目录").font(.title.bold())
                    Text("适用于所有工作区").foregroundStyle(.secondary)
                }
                Spacer()
                Button("添加文件夹…", systemImage: "plus", action: model.addAccessDirectory)
            }
            if model.sharedDirectories.isEmpty {
                ContentUnavailableView("还没有共用目录", systemImage: "folder.badge.plus",
                                       description: Text("添加一次，即可在所有工作区访问。"))
            } else {
                VStack(spacing: 0) {
                    ForEach($model.sharedDirectories) { $directory in
                        AccessDirectoryRow(directory: $directory,
                                           replace: { model.replaceAccessDirectory(directory.id) },
                                           remove: { model.removeAccessDirectory(directory.id) })
                        if directory.id != model.sharedDirectories.last?.id { Divider().padding(.horizontal, 20) }
                    }
                }.background(.background, in: .rect(cornerRadius: 12))
            }
        }.disabled(model.busy)
    }
}
