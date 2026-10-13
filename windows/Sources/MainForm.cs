using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace GptBridge
{
    public sealed class MainForm : Form
    {
        private Configuration config;
        private readonly ConfigurationStore store;
        private bool loading;
        private readonly Dictionary<string, string> pendingKeys = new Dictionary<string, string>();
        internal bool PermitClose;
        private readonly Label status = new Label();
        private readonly Label activeRoot = new Label();
        private readonly Label feedback = new Label();
        private readonly TabControl tabs = new TabControl();
        private readonly ComboBox connections = new ComboBox();
        private readonly TextBox connectionName = new TextBox();
        private readonly TextBox tunnel = new TextBox();
        private readonly TextBox secret = new TextBox();
        private readonly Label keyHint = new Label();
        private readonly ListBox workspaces = new ListBox();
        private readonly TextBox root = new TextBox();
        private readonly ComboBox rootAccess = new ComboBox();
        private readonly CheckBox commands = new CheckBox();
        private readonly Label inheritedAccess = new Label();
        private readonly CheckBox autoConnect = new CheckBox();
        private readonly CheckBox startup = new CheckBox();
        private readonly DataGridView directories = new DataGridView();
        private readonly Button save = new Button();
        private readonly Button connect = new Button();
        private readonly Button disconnect = new Button();
        private readonly Button exit = new Button();
        public event Action SaveRequested;
        public event Action ConnectRequested;
        public event Action DisconnectRequested;
        public event Action ExitRequested;
        public event Action ShowRequested;

        public MainForm(Configuration initial, ConfigurationStore configurationStore)
        {
            store = configurationStore; config = initial;
            Text = "gpt-bridge"; Name = "GptBridgeMain";
            Font = new Font("Microsoft YaHei UI", 9F); BackColor = Color.FromArgb(244, 247, 249);
            AutoScaleMode = AutoScaleMode.Dpi; StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(920, 710); MinimumSize = new Size(840, 710);
            Icon = BridgeIcon.Create(Color.FromArgb(15, 118, 110));
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(24, 18, 24, 18) };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            Controls.Add(layout);
            var header = new Panel { Dock = DockStyle.Fill };
            header.Controls.Add(new Label { Text = "gpt-bridge", Font = new Font(Font.FontFamily, 21, FontStyle.Bold), AutoSize = true, Location = new Point(0, 0) });
            status.Text = "未连接"; status.AutoSize = true; status.ForeColor = Color.FromArgb(15, 118, 110); status.Location = new Point(240, 14); header.Controls.Add(status);
            activeRoot.AutoEllipsis = true; activeRoot.Size = new Size(820, 30); activeRoot.Location = new Point(0, 52);
            activeRoot.Text = "将本地工作区连接到 ChatGPT。关闭窗口后，连接和托盘图标继续运行。"; header.Controls.Add(activeRoot);
            layout.Controls.Add(header, 0, 0);
            tabs.Dock = DockStyle.Fill; layout.Controls.Add(tabs, 0, 1);
            var workspacePage = Page("工作区"); BuildWorkspaces(workspacePage);
            var sharedPage = Page("共用目录"); BuildShared(sharedPage);
            var settingsPage = Page("连接与设置"); BuildSettings(settingsPage);
            feedback.Dock = DockStyle.Fill; feedback.AutoEllipsis = true; feedback.Padding = new Padding(0, 12, 0, 0);
            feedback.Text = "保存只更新配置；应用并连接会启用当前工作区及共用目录权限。"; layout.Controls.Add(feedback, 0, 2);
            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            SetButton(connect, "应用并连接", delegate { if (ConnectRequested != null) ConnectRequested(); }); connect.BackColor = Color.FromArgb(15, 118, 110); connect.ForeColor = Color.White;
            SetButton(save, "保存", delegate { if (SaveRequested != null) SaveRequested(); });
            SetButton(disconnect, "断开", delegate { if (DisconnectRequested != null) DisconnectRequested(); });
            SetButton(exit, "断开并退出", delegate { if (ExitRequested != null) ExitRequested(); });
            actions.Controls.AddRange(new Control[] { connect, save, disconnect, exit }); layout.Controls.Add(actions, 0, 3);
            FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (!PermitClose && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            };
            Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); };
            BindAll();
        }
        private TabPage Page(string name)
        {
            var page = new TabPage(name) { Padding = new Padding(18), BackColor = Color.White };
            tabs.TabPages.Add(page); return page;
        }
        private static Button Button(string text, Action clicked)
        {
            var button = new Button(); SetButton(button, text, clicked); return button;
        }
        private static void SetButton(Button button, string text, Action clicked)
        {
            button.Text = text; button.AutoSize = true; button.MinimumSize = new Size(98, 34);
            button.Padding = new Padding(8, 0, 8, 0); button.FlatStyle = FlatStyle.Flat;
            button.Margin = new Padding(6, 0, 0, 0); button.Click += delegate { clicked(); };
        }
        private static Label Label(string text) { return new Label { Text = text, AutoSize = true, Margin = new Padding(0, 10, 0, 6) }; }
        private static FlowLayoutPanel Stack() { return new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true }; }
        private void BuildWorkspaces(TabPage page)
        {
            var split = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
            split.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 230)); split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            page.Controls.Add(split);
            var sidebar = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(0, 0, 18, 0) };
            sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 36)); sidebar.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); sidebar.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            sidebar.Controls.Add(Label("本地工作区"), 0, 0);
            workspaces.Dock = DockStyle.Fill; workspaces.IntegralHeight = false; workspaces.BorderStyle = BorderStyle.FixedSingle;
            workspaces.SelectedIndexChanged += delegate { if (!loading && workspaces.SelectedItem != null) { CaptureWorkspace(); config.Selected.selectedWorkspaceID = ((Workspace)workspaces.SelectedItem).id; BindWorkspace(); } };
            sidebar.Controls.Add(workspaces, 0, 1);
            var tools = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(0, 7, 0, 0) };
            Button add = Button("添加", AddWorkspace), remove = Button("移除", RemoveWorkspace);
            add.AutoSize = remove.AutoSize = false; add.MinimumSize = remove.MinimumSize = new Size(80, 34); add.Size = remove.Size = new Size(80, 34);
            tools.Controls.Add(add); tools.Controls.Add(remove); sidebar.Controls.Add(tools, 0, 2);
            split.Controls.Add(sidebar, 0, 0);
            var detail = Stack(); split.Controls.Add(detail, 1, 0);
            detail.Controls.Add(Label("主工作目录")); root.ReadOnly = true; root.Width = 520; detail.Controls.Add(root);
            detail.Controls.Add(Button("更换文件夹", ChangeRoot));
            detail.Controls.Add(Label("主目录的文件工具权限"));
            rootAccess.DropDownStyle = ComboBoxStyle.DropDownList; rootAccess.Items.AddRange(new object[] { "读写", "只读" }); rootAccess.Width = 200; detail.Controls.Add(rootAccess);
            inheritedAccess.Size = new Size(515, 32); inheritedAccess.ForeColor = Color.DimGray; detail.Controls.Add(inheritedAccess);
            commands.Text = "允许本机命令执行"; commands.AutoSize = true; commands.Margin = new Padding(0, 18, 0, 6); detail.Controls.Add(commands);
            detail.Controls.Add(new Label { Text = "开启后，命令以当前 Windows 用户权限运行。\n目录只读规则仅约束文件工具，无法隔离任意命令。", Size = new Size(515, 54), ForeColor = Color.DimGray });
            detail.Controls.Add(new Label { Text = "共用目录适用于所有工作区。切换工作区后，\n更具体的共用目录权限仍会生效。", Size = new Size(515, 54), Margin = new Padding(0, 18, 0, 0), ForeColor = Color.DimGray });
        }
        private void BuildShared(TabPage page)
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1 };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 54)); page.Controls.Add(layout);
            layout.Controls.Add(Label("所有连接和工作区共用。修改后点击“应用并连接”才会更新正在运行的权限。"), 0, 0);
            directories.Dock = DockStyle.Fill; directories.AutoGenerateColumns = false; directories.AllowUserToAddRows = false; directories.AllowUserToDeleteRows = false;
            directories.RowHeadersVisible = false; directories.SelectionMode = DataGridViewSelectionMode.FullRowSelect; directories.MultiSelect = false;
            directories.BackgroundColor = Color.White; directories.BorderStyle = BorderStyle.FixedSingle; directories.RowTemplate.Height = 32;
            directories.Columns.Add(new DataGridViewTextBoxColumn { Name = "folder", HeaderText = "文件夹", Width = 150, ReadOnly = true });
            directories.Columns.Add(new DataGridViewTextBoxColumn { Name = "path", HeaderText = "路径", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, ReadOnly = true });
            directories.Columns.Add(new DataGridViewComboBoxColumn { Name = "access", HeaderText = "权限", Width = 100, Items = { "只读", "读写" } });
            directories.CurrentCellDirtyStateChanged += delegate { if (directories.IsCurrentCellDirty) directories.CommitEdit(DataGridViewDataErrorContexts.Commit); };
            directories.CellValueChanged += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (!loading && e.RowIndex >= 0 && e.ColumnIndex == 2)
                    ((AccessDirectory)directories.Rows[e.RowIndex].Tag).access = (string)directories.Rows[e.RowIndex].Cells[2].Value == "读写" ? "readWrite" : "readOnly";
            };
            layout.Controls.Add(directories, 0, 1);
            var tools = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(0, 8, 0, 0) };
            tools.Controls.Add(Button("添加文件夹", AddDirectory));
            tools.Controls.Add(Button("移除所选", delegate { if (directories.SelectedRows.Count > 0) { config.sharedDirectories.Remove((AccessDirectory)directories.SelectedRows[0].Tag); BindDirectories(); } }));
            layout.Controls.Add(tools, 0, 2);
        }
        private void BuildSettings(TabPage page)
        {
            var stack = Stack(); page.Controls.Add(stack);
            var row = new FlowLayoutPanel { Width = 800, Height = 38, WrapContents = false };
            connections.Width = 330; connections.DropDownStyle = ComboBoxStyle.DropDownList;
            connections.SelectedIndexChanged += delegate
            {
                if (!loading && connections.SelectedItem != null) { CollectConfiguration(); config.selectedID = ((Connection)connections.SelectedItem).id; BindAll(); }
            };
            row.Controls.Add(connections);
            row.Controls.Add(Button("新增连接", delegate { CollectConfiguration(); var c = new Connection(); c.name = "连接 " + (config.connections.Count + 1); config.connections.Add(c); config.selectedID = c.id; BindAll(); }));
            row.Controls.Add(Button("移除连接", delegate { if (config.connections.Count < 2) { Notify("至少保留一份连接资料。", false); return; } config.connections.Remove(config.Selected); config.selectedID = config.connections[0].id; BindAll(); })); stack.Controls.Add(row);
            stack.Controls.Add(Label("连接名称")); connectionName.Width = 600; stack.Controls.Add(connectionName);
            stack.Controls.Add(Label("Tunnel ID")); tunnel.Width = 600; stack.Controls.Add(tunnel);
            stack.Controls.Add(Label("Runtime API key")); secret.UseSystemPasswordChar = true; secret.Width = 600; stack.Controls.Add(secret);
            keyHint.Size = new Size(780, 26); keyHint.ForeColor = Color.DimGray; stack.Controls.Add(keyHint);
            startup.Text = "登录 Windows 时启动（后台托盘）"; startup.AutoSize = true; stack.Controls.Add(startup);
            autoConnect.Text = "打开应用后自动连接"; autoConnect.AutoSize = true; stack.Controls.Add(autoConnect);
            stack.Controls.Add(new Label { Text = "主动断开后会暂停自动连接，直到再次点击“应用并连接”。", AutoSize = true, ForeColor = Color.DimGray });
            var links = new FlowLayoutPanel { Width = 800, Height = 42, Padding = new Padding(0, 8, 0, 0) };
            links.Controls.Add(Button("隧道设置", delegate { OpenUrl("https://platform.openai.com/settings/organization/tunnels"); }));
            links.Controls.Add(Button("打开数据目录", delegate { System.Diagnostics.Process.Start("explorer.exe", RuntimeClient.Quote(store.Root)); }));
            stack.Controls.Add(links);
            stack.SizeChanged += delegate { row.Width = links.Width = Math.Max(620, stack.ClientSize.Width - 12); keyHint.Width = row.Width; };
        }
        private static void OpenUrl(string url) { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
        private string ChooseFolder(string current)
        {
            using (var picker = new FolderBrowserDialog { Description = "选择本地文件夹（不能选择整个磁盘）", SelectedPath = current, ShowNewFolderButton = true })
            {
                if (picker.ShowDialog(this) != DialogResult.OK) return null;
                try { return PathRules.Directory(picker.SelectedPath); }
                catch (Exception e) { Notify(e.Message, true); return null; }
            }
        }
        private void AddWorkspace()
        {
            string path = ChooseFolder(""); if (path == null) return; CollectConfiguration();
            var existing = config.Selected.workspaces.FirstOrDefault(w => PathRules.Equal(w.root, path));
            var workspace = existing ?? new Workspace { root = path };
            if (existing == null) config.Selected.workspaces.Add(workspace);
            config.Selected.selectedWorkspaceID = workspace.id; BindAll();
        }
        private void RemoveWorkspace()
        {
            if (config.Selected.workspaces.Count == 1) { Notify("至少保留一个工作区。", false); return; }
            CollectConfiguration(); config.Selected.workspaces.Remove(config.Selected.SelectedWorkspace); config.Selected.selectedWorkspaceID = config.Selected.workspaces[0].id; BindAll();
        }
        private void ChangeRoot() { string path = ChooseFolder(root.Text); if (path != null) { CollectConfiguration(); config.Selected.SelectedWorkspace.root = path; BindAll(); } }
        private void AddDirectory()
        {
            string path = ChooseFolder(""); if (path == null) return;
            if (config.sharedDirectories.Any(d => PathRules.Equal(d.path, path))) { Notify("此共用目录已添加。", false); return; }
            config.sharedDirectories.Add(new AccessDirectory { path = path }); BindDirectories();
        }
        private void CaptureWorkspace()
        {
            if (loading || config.Selected.SelectedWorkspace == null) return;
            Workspace w = config.Selected.SelectedWorkspace; w.rootAccess = rootAccess.SelectedIndex == 1 ? "readOnly" : "readWrite"; w.allowCommands = commands.Checked;
        }
        public Configuration CollectConfiguration()
        {
            CaptureWorkspace(); config.Selected.name = connectionName.Text; config.Selected.tunnelID = tunnel.Text;
            if (!String.IsNullOrWhiteSpace(secret.Text)) pendingKeys[config.Selected.id] = secret.Text;
            config.startAtLogin = startup.Checked; config.connectOnLaunch = autoConnect.Checked; directories.EndEdit(); return config;
        }
        public IDictionary<string, string> PendingKeys { get { return pendingKeys; } }
        public void Saved() { pendingKeys.Clear(); secret.Clear(); BindAll(); }
        public void SelectWorkspace(string id) { CollectConfiguration(); config.Selected.selectedWorkspaceID = id; BindAll(); }
        private void BindAll()
        {
            loading = true;
            try
            {
                connections.Items.Clear(); connections.Items.AddRange(config.connections.Cast<object>().ToArray()); connections.SelectedItem = config.Selected;
                connectionName.Text = config.Selected.name; tunnel.Text = config.Selected.tunnelID;
                string pending; secret.Text = pendingKeys.TryGetValue(config.Selected.id, out pending) ? pending : "";
                startup.Checked = config.startAtLogin; autoConnect.Checked = config.connectOnLaunch;
                workspaces.Items.Clear(); workspaces.Items.AddRange(config.Selected.workspaces.Cast<object>().ToArray()); workspaces.SelectedItem = config.Selected.SelectedWorkspace;
                keyHint.Text = store.HasKey(config.Selected.id) ? "已保存密钥；留空继续使用。密钥使用当前 Windows 用户的 DPAPI 加密。" : "密钥只在本机加密保存。请填写同一组织中具备隧道 Read + Use 权限的 Runtime key。";
                BindWorkspace(); BindDirectories();
            }
            finally { loading = false; }
        }
        private void BindWorkspace()
        {
            Workspace w = config.Selected.SelectedWorkspace; root.Text = w.root; rootAccess.SelectedIndex = w.rootAccess == "readOnly" ? 1 : 0; commands.Checked = w.allowCommands;
            UpdateInheritedAccess();
        }
        private void UpdateInheritedAccess()
        {
            string workspaceRoot = config.Selected.SelectedWorkspace.root;
            AccessDirectory inherited = config.sharedDirectories.Where(d => PathRules.Within(workspaceRoot, d.path)).OrderByDescending(d => d.path.Length).FirstOrDefault();
            inheritedAccess.Text = inherited != null && inherited.access == "readOnly" ? "共用目录的只读规则会同时约束此主目录。" : "";
        }
        private void BindDirectories()
        {
            bool previous = loading; loading = true;
            try
            {
                directories.Rows.Clear();
                foreach (AccessDirectory d in config.sharedDirectories)
                {
                    int index = directories.Rows.Add(Path.GetFileName(d.path.TrimEnd('\\')), d.path, d.access == "readOnly" ? "只读" : "读写"); directories.Rows[index].Tag = d;
                }
            }
            finally { loading = previous; UpdateInheritedAccess(); }
        }
        public void SetBusy(bool busy) { tabs.Enabled = !busy; save.Enabled = connect.Enabled = disconnect.Enabled = exit.Enabled = !busy; }
        public void UpdateStatus(RuntimeStatus value)
        {
            status.Text = value.Label + (value.activeTasks > 0 ? " · 活动任务 " + value.activeTasks : "");
            activeRoot.Text = value.running ? "当前运行目录：" + value.activeWorkspaceRoot : "关闭窗口后，应用常驻任务栏右侧托盘。双击托盘图标可重新打开。";
        }
        public void Notify(string message, bool error) { feedback.Text = message; feedback.ForeColor = error ? Color.Firebrick : Color.DimGray; }
        public void ShowSettings() { Show(); WindowState = FormWindowState.Normal; Activate(); BringToFront(); }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == Program.ShowMessage && ShowRequested != null) ShowRequested();
            base.WndProc(ref message);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && Icon != null) { Icon.Dispose(); Icon = null; }
            base.Dispose(disposing);
        }
    }
}
