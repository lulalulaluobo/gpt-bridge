import SwiftUI

struct MethodLibraryView: View {
    @State private var model = MethodLibraryModel()
    @State private var selected: MethodDocument?
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Text("方法库").font(.title.bold())
                Spacer()
                Button("刷新", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                Button("添加目录…", systemImage: "folder.badge.plus") { Task { await model.addDirectory() } }
            }.disabled(model.busy || !model.loaded)
            Text("供 GPT 参考的方法文档 · 只读").foregroundStyle(.secondary)
            ForEach(model.directories, id: \.self) { directory in
                HStack(spacing: 12) {
                    Image(systemName: "folder").foregroundStyle(.blue)
                    Text(directory).textSelection(.enabled).lineLimit(2).truncationMode(.middle)
                    Spacer()
                    Button("移除", systemImage: "minus.circle") { Task { await model.remove(directory) } }
                        .labelStyle(.iconOnly).help("从方法库移除目录，不删除文件")
                }.disabled(model.busy)
            }
            Divider()
            HStack {
                TextField("搜索名称或内容", text: $model.query).textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await model.refresh() } }
                Button("搜索") { Task { await model.refresh() } }.disabled(model.busy)
            }
            if model.busy { ProgressView().controlSize(.small) }
            if let error = model.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            if let notice = model.notice { Text(notice).foregroundStyle(.secondary).textSelection(.enabled) }
            if model.directories.isEmpty {
                ContentUnavailableView("添加你的 Skills 文件夹", systemImage: "books.vertical",
                                       description: Text("添加后，网页 GPT 可直接发现相关方法。"))
            } else {
                HStack {
                    Text("\(model.matched) 份方法").foregroundStyle(.secondary)
                    Spacer()
                    if let date = model.refreshedAt { Text(date, style: .time).foregroundStyle(.secondary) }
                }
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.documents) { document in
                        Button { selected = document } label: {
                            VStack(alignment: .leading, spacing: 7) {
                                Text(document.title).font(.headline)
                                Text(document.preview).foregroundStyle(.secondary).lineLimit(2)
                                Text(document.document_path).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16).contentShape(.rect)
                        }.buttonStyle(.plain).disabled(model.busy)
                        Divider()
                    }
                }
                if model.nextOffset != nil {
                    Button("显示更多") { Task { await model.refresh(more: true) } }.disabled(model.busy)
                }
            }
        }
        .task { await model.refresh() }
        .sheet(item: $selected) { document in
            VStack(alignment: .leading, spacing: 16) {
                HStack { Text(document.title).font(.title2.bold()); Spacer(); Button("完成") { selected = nil }.disabled(model.busy) }
                Text(document.id).foregroundStyle(.secondary).textSelection(.enabled)
                ScrollView { Text(model.preview).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled) }
                if let error = model.error { Text(error).foregroundStyle(.red) }
                if model.busy { ProgressView() }
                if model.previewNextOffset != nil { Button("继续读取") { Task { await model.read(document, more: true) } }.disabled(model.busy) }
            }.padding(24).frame(minWidth: 620, minHeight: 500)
                .task { await model.read(document) }
        }
    }
}
