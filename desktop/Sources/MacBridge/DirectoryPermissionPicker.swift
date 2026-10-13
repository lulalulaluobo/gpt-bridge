import SwiftUI

struct DirectoryPermissionPicker: View {
    @Binding var access: DirectoryAccess
    var body: some View {
        Picker("文件权限", selection: $access) {
            ForEach(DirectoryAccess.allCases) { value in Text(value.title).tag(value) }
        }.pickerStyle(.segmented).frame(maxWidth: 240)
    }
}
