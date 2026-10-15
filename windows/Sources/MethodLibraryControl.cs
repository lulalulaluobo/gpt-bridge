using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace GptBridge
{
    public sealed class MethodLibraryControl : UserControl
    {
        private readonly RuntimeClient client;
        private MethodLibraryStore store;
        private readonly ListBox folders = new ListBox();
        private readonly TextBox query = new TextBox();
        private readonly DataGridView documents = new DataGridView();
        private readonly Label notice = new Label();
        private readonly Label summary = new Label();
        private readonly Button more = new Button();
        private readonly List<Control> actions = new List<Control>();
        private bool busy;
        private bool refreshed;
        private int? nextOffset;
        private string searchedQuery = "";

        public MethodLibraryControl(string root, RuntimeClient runtime)
        {
            client = runtime;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 8 };
            foreach (int height in new[] { 24, 58, 40, 34, 40 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            Controls.Add(layout);
            layout.Controls.Add(new Label { Text = "供 GPT 参考的方法文档 · 只读 · 目录变更即时生效", Dock = DockStyle.Fill, ForeColor = Color.DimGray }, 0, 0);
            folders.Dock = DockStyle.Fill; folders.HorizontalScrollbar = true; folders.IntegralHeight = false;
            layout.Controls.Add(folders, 0, 1);
            var directoryActions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = Padding.Empty, Padding = new Padding(0, 4, 0, 0) };
            directoryActions.Controls.Add(MakeButton("添加目录…", AddDirectory));
            directoryActions.Controls.Add(MakeButton("输入路径…", EnterDirectory));
            directoryActions.Controls.Add(MakeButton("移除所选", RemoveDirectory));
            directoryActions.Controls.Add(MakeButton("刷新", async () => await Search(false)));
            layout.Controls.Add(directoryActions, 0, 2);
            var searchRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Margin = Padding.Empty };
            searchRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); searchRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 98));
            query.Dock = DockStyle.Fill; query.MaxLength = 200; query.AccessibleName = "搜索方法名称或内容";
            query.KeyDown += async delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await Search(false); } };
            searchRow.Controls.Add(query, 0, 0); actions.Add(query);
            searchRow.Controls.Add(MakeButton("搜索", async () => await Search(false)), 1, 0); layout.Controls.Add(searchRow, 0, 3);
            notice.Dock = DockStyle.Fill; notice.AutoEllipsis = true; notice.ForeColor = Color.DimGray;
            layout.Controls.Add(notice, 0, 4);
            documents.Dock = DockStyle.Fill; documents.AutoGenerateColumns = false; documents.AllowUserToAddRows = false; documents.AllowUserToDeleteRows = false;
            documents.ReadOnly = true; documents.MultiSelect = false; documents.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            documents.RowHeadersVisible = false; documents.BackgroundColor = Color.White; documents.BorderStyle = BorderStyle.FixedSingle;
            documents.RowTemplate.Height = 32;
            documents.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "方法名称", Width = 170 });
            documents.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "内容预览", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
            documents.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "文档路径", Width = 210 });
            documents.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e) { if (e.RowIndex >= 0) OpenSelected(); };
            layout.Controls.Add(documents, 0, 5); actions.Add(documents);
            summary.Dock = DockStyle.Fill; summary.Padding = new Padding(0, 6, 0, 0); summary.ForeColor = Color.DimGray; layout.Controls.Add(summary, 0, 6);
            var bottom = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = Padding.Empty };
            bottom.Controls.Add(MakeButton("查看正文", delegate { OpenSelected(); return Task.FromResult(0); }));
            more = MakeButton("显示更多", async () => await Search(true)); more.Visible = false; bottom.Controls.Add(more); layout.Controls.Add(bottom, 0, 7);
            try { store = new MethodLibraryStore(root, client.Resources); BindFolders(); }
            catch (Exception error) { ShowError(error); SetBusy(false); }
        }
        private Button MakeButton(string text, Func<Task> clicked)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(90, 32), FlatStyle = FlatStyle.Flat, Margin = new Padding(0, 0, 8, 0) };
            button.Click += async delegate { if (!busy && store != null) await clicked(); }; actions.Add(button); return button;
        }
        private void BindFolders()
        {
            folders.Items.Clear(); folders.Items.AddRange(store.Directories.Cast<object>().ToArray());
            notice.Text = store.Directories.Count == 0 ? "添加你的 Skills 文件夹，网页 GPT 即可检索相关方法。隐藏目录可通过“输入路径”添加。" : "双击搜索结果查看正文；移除目录只撤销方法库访问。";
        }
        public async Task RefreshIfNeeded() { if (!refreshed && store != null && !busy) await Search(false); }
        private async Task AddDirectory()
        {
            using (var picker = new FolderBrowserDialog { Description = "添加方法资料目录（仅授权 Skill 文档只读）", ShowNewFolderButton = false })
            { if (picker.ShowDialog(this) == DialogResult.OK) await AddPath(picker.SelectedPath); }
        }
        private async Task EnterDirectory()
        {
            using (var dialog = new Form { Text = "添加方法资料目录", ClientSize = new Size(620, 155), StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MinimizeBox = false, MaximizeBox = false, Font = Font })
            {
                var input = new TextBox { Location = new Point(18, 52), Width = 580, AccessibleName = "方法库文件夹完整路径" };
                dialog.Controls.Add(new Label { Text = "输入完整的本地文件夹路径，支持 .codex、.claude 等隐藏目录。", AutoSize = true, Location = new Point(18, 20) });
                var accept = new Button { Text = "允许只读", DialogResult = DialogResult.OK, Location = new Point(390, 100), Size = new Size(100, 34) };
                var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Location = new Point(500, 100), Size = new Size(98, 34) };
                dialog.Controls.AddRange(new Control[] { input, accept, cancel }); dialog.AcceptButton = accept; dialog.CancelButton = cancel;
                if (dialog.ShowDialog(this) == DialogResult.OK) await AddPath(input.Text.Trim());
            }
        }
        private async Task AddPath(string path)
        {
            try { store.Add(path); BindFolders(); await Search(false); }
            catch (Exception error) { ShowError(error); }
        }
        private async Task RemoveDirectory()
        {
            if (folders.SelectedItem == null) return;
            try { store.Remove((string)folders.SelectedItem); BindFolders(); await Search(false); }
            catch (Exception error) { ShowError(error); }
        }
        private async Task Search(bool append)
        {
            if (busy || store == null || (append && !nextOffset.HasValue)) return;
            SetBusy(true); notice.ForeColor = Color.DimGray; notice.Text = "正在从磁盘读取方法文档…";
            if (!append) { documents.Rows.Clear(); summary.Text = ""; nextOffset = null; searchedQuery = query.Text; }
            try
            {
                if (store.Directories.Count == 0) { BindFolders(); summary.Text = "0 份方法"; refreshed = true; return; }
                MethodSearchResponse result = await client.QueryMethods<MethodSearchResponse>(new { action = "search", query = searchedQuery, offset = append ? nextOffset.Value : 0, limit = 20 });
                if (IsDisposed) return;
                var seen = new HashSet<string>(documents.Rows.Cast<DataGridViewRow>().Select(r => ((MethodDocument)r.Tag).Identity), StringComparer.OrdinalIgnoreCase);
                foreach (MethodDocument document in result.results)
                    if (seen.Add(document.Identity)) { int row = documents.Rows.Add(document.title, document.preview, document.document_path); documents.Rows[row].Tag = document; }
                nextOffset = result.nextOffset; refreshed = true;
                summary.Text = result.matched + " 份方法 · 已显示 " + documents.Rows.Count + " · 更新于 " + DateTime.Now.ToString("HH:mm:ss");
                var notes = (result.errors ?? new List<MethodDirectoryError>()).Select(e => e.path + "：" + e.error).ToList();
                if (result.incomplete) notes.Add("扫描达到上限，请选择更具体的资料目录。");
                if (result.skipped > 0) notes.Add("跳过 " + result.skipped + " 个链接、不可读或超大文档。");
                notice.Text = notes.Count > 0 ? String.Join("\r\n", notes) : "每次搜索均读取最新文档。双击结果查看正文，方法文档不构成命令执行授权。";
            }
            catch (Exception error) { if (!IsDisposed) ShowError(error); }
            finally { if (!IsDisposed) { more.Visible = nextOffset.HasValue; SetBusy(false); } }
        }
        private void OpenSelected()
        {
            if (busy || documents.SelectedRows.Count == 0) return;
            MethodDocument document = (MethodDocument)documents.SelectedRows[0].Tag;
            using (var preview = new MethodPreviewForm(client, document)) preview.ShowDialog(this);
        }
        private void ShowError(Exception error) { notice.Text = error.Message; notice.ForeColor = Color.Firebrick; }
        private void SetBusy(bool value) { busy = value; foreach (Control action in actions) action.Enabled = !value && store != null; folders.Enabled = !value && store != null; }
    }

    internal sealed class MethodPreviewForm : Form
    {
        private readonly RuntimeClient client;
        private readonly MethodDocument document;
        private readonly TextBox content = new TextBox();
        private readonly Label notice = new Label();
        private readonly Button more = new Button();
        private int? nextOffset;
        private bool busy;
        public MethodPreviewForm(RuntimeClient runtime, MethodDocument selected)
        {
            client = runtime; document = selected;
            Text = selected.title; Font = new Font("Microsoft YaHei UI", 9F); StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(760, 570); MinimumSize = new Size(620, 450); AutoScaleMode = AutoScaleMode.Dpi;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(18) };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40)); Controls.Add(layout);
            layout.Controls.Add(new TextBox { Text = selected.library_path + "\\" + selected.document_path, ReadOnly = true, Dock = DockStyle.Fill }, 0, 0);
            content.Multiline = true; content.ReadOnly = true; content.ScrollBars = ScrollBars.Both; content.Dock = DockStyle.Fill; content.Font = new Font("Consolas", 10F); layout.Controls.Add(content, 0, 1);
            notice.Dock = DockStyle.Fill; notice.AutoEllipsis = true; layout.Controls.Add(notice, 0, 2);
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, Margin = Padding.Empty };
            more.Text = "继续读取"; more.Size = new Size(110, 32); more.Visible = false; more.Click += async delegate { await Read(true); };
            var done = new Button { Text = "完成", DialogResult = DialogResult.OK, Size = new Size(98, 32) };
            buttons.Controls.AddRange(new Control[] { more, done }); layout.Controls.Add(buttons, 0, 3); CancelButton = done;
            Shown += async delegate { await Read(false); };
        }
        private async Task Read(bool append)
        {
            if (busy || (append && !nextOffset.HasValue)) return;
            busy = true; more.Enabled = false; notice.Text = "正在读取…";
            try
            {
                MethodReadResponse result = await client.QueryMethods<MethodReadResponse>(new { action = "read", library_path = document.library_path, document_path = document.document_path, offset = append ? nextOffset.Value : 0, length = 100 });
                if (IsDisposed) return;
                string text = result.text.Replace("\r\n", "\n").Replace("\n", "\r\n");
                if (append) content.AppendText("\r\n" + text);
                else { content.Text = text; content.SelectionStart = 0; content.ScrollToCaret(); }
                nextOffset = result.nextOffset;
                notice.Text = nextOffset.HasValue ? "正文尚未读完，请继续读取。" : "正文已完整读取。"; notice.ForeColor = Color.DimGray;
            }
            catch (Exception error) { if (!IsDisposed) { notice.Text = error.Message; notice.ForeColor = Color.Firebrick; } }
            finally { if (!IsDisposed) { more.Visible = nextOffset.HasValue; more.Enabled = true; busy = false; } }
        }
    }
}
