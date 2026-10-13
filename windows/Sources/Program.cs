using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("gpt-bridge")]
[assembly: System.Reflection.AssemblyVersion("0.11.0.0")]

namespace GptBridge
{
    public static class Program
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int RegisterWindowMessage(string name);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        internal static readonly int ShowMessage = RegisterWindowMessage("gpt-bridge.Show." + WindowsIdentity.GetCurrent().User.Value);
        [STAThread] public static void Main(string[] args)
        {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            bool first;
            using (var instance = new Mutex(true, @"Local\gpt-bridge." + WindowsIdentity.GetCurrent().User.Value, out first))
            {
                if (!first)
                {
                    if (!args.Contains("--background")) PostMessage(new IntPtr(0xffff), ShowMessage, IntPtr.Zero, IntPtr.Zero);
                    return;
                }
                try
                {
                    string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "gpt-bridge");
                    var store = new ConfigurationStore(root);
                    using (var context = new TrayApplicationContext(store, new RuntimeClient(root, Path.Combine(Application.StartupPath, "resources")), args.Contains("--background")))
                    {
                        context.Initialize(); Application.Run(context);
                    }
                }
                catch (Exception error) { MessageBox.Show(error.Message, "gpt-bridge", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                finally { instance.ReleaseMutex(); }
            }
        }
    }

    public static class BridgeIcon
    {
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
        public static Icon Create(Color color)
        {
            using (var bitmap = new Bitmap(32, 32))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (var pen = new Pen(color, 3.2F))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias; graphics.Clear(Color.Transparent);
                pen.StartCap = pen.EndCap = LineCap.Round;
                graphics.DrawLine(pen, 4, 23, 28, 23); graphics.DrawArc(pen, 7, 7, 18, 27, 180, 180);
                graphics.DrawLine(pen, 7, 12, 7, 26); graphics.DrawLine(pen, 25, 12, 25, 26);
                graphics.DrawLine(pen, 12, 13, 12, 23); graphics.DrawLine(pen, 20, 13, 20, 23);
                IntPtr handle = bitmap.GetHicon();
                try { using (Icon temporary = Icon.FromHandle(handle)) return (Icon)temporary.Clone(); }
                finally { DestroyIcon(handle); }
            }
        }
    }

    public sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly ConfigurationStore store;
        private readonly RuntimeClient runtime;
        internal readonly MainForm Window;
        internal readonly NotifyIcon Tray;
        private readonly ContextMenuStrip menu;
        private readonly System.Windows.Forms.Timer timer;
        private RuntimeStatus status = new RuntimeStatus();
        private bool busy;
        private bool refreshing;
        private bool exiting;
        private readonly Icon connectedIcon = BridgeIcon.Create(Color.FromArgb(15, 118, 110));
        private readonly Icon disconnectedIcon = BridgeIcon.Create(Color.Gray);
        public TrayApplicationContext(ConfigurationStore configurationStore, RuntimeClient runtimeClient, bool background)
        {
            store = configurationStore; runtime = runtimeClient;
            Window = new MainForm(store.Load(), store);
            menu = new ContextMenuStrip(); menu.Opening += delegate { BuildMenu(); };
            Tray = new NotifyIcon { Icon = disconnectedIcon, Text = "gpt-bridge · 未连接", ContextMenuStrip = menu, Visible = true };
            Tray.DoubleClick += delegate { Window.ShowSettings(); };
            Window.ShowRequested += Window.ShowSettings;
            Window.SaveRequested += Save;
            Window.ConnectRequested += async delegate { await Connect(); };
            Window.DisconnectRequested += async delegate { await Disconnect(false); };
            Window.ExitRequested += async delegate { await Disconnect(true); };
            Window.FormClosed += delegate { ExitThread(); };
            timer = new System.Windows.Forms.Timer { Interval = 10000 };
            timer.Tick += async delegate { await Refresh(); };
            // Always create a handle for second-instance activation, including background startup.
            IntPtr handle = Window.Handle;
            if (!background) Window.Show();
            BuildMenu();
        }
        public void Initialize()
        {
            Window.BeginInvoke(new Action(async delegate
            {
                await Refresh();
                Configuration config = Window.CollectConfiguration();
                if (!status.running && config.connectOnLaunch && !config.manuallyDisconnected) await Connect();
                timer.Start();
            }));
        }
        private void BuildMenu()
        {
            foreach (ToolStripItem item in menu.Items.Cast<ToolStripItem>().ToArray()) item.Dispose();
            menu.Items.Clear();
            menu.Items.Add(new ToolStripMenuItem(status.Label) { Enabled = false });
            menu.Items.Add("打开设置", null, delegate { Window.ShowSettings(); });
            var workspaceMenu = new ToolStripMenuItem("切换工作区") { Enabled = !busy };
            Configuration config = Window.CollectConfiguration();
            foreach (Workspace workspace in config.Selected.workspaces)
            {
                string id = workspace.id;
                var item = new ToolStripMenuItem(workspace.ToString()) { Checked = status.running && status.activeWorkspaceID == id };
                item.Click += async delegate { Window.SelectWorkspace(id); await Connect(); }; workspaceMenu.DropDownItems.Add(item);
            }
            menu.Items.Add(workspaceMenu); menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("应用并连接", null, async delegate { await Connect(); }) { Enabled = !busy });
            menu.Items.Add(new ToolStripMenuItem("断开", null, async delegate { await Disconnect(false); }) { Enabled = !busy });
            menu.Items.Add(new ToolStripMenuItem("断开并退出", null, async delegate { await Disconnect(true); }) { Enabled = !busy });
        }
        private Configuration SaveConfiguration()
        {
            Configuration config = Window.CollectConfiguration(); config.Validate();
            foreach (var pending in Window.PendingKeys)
                if (config.connections.Any(c => c.id == pending.Key)) store.SaveKey(pending.Key, pending.Value);
            StartupManager.Set(config.startAtLogin); store.Save(config); Window.Saved(); return config;
        }
        private void Save()
        {
            if (busy) return;
            try { SaveConfiguration(); Window.Notify("配置已保存；当前运行中的权限保持到下次应用。", false); }
            catch (Exception error) { Report(error); }
        }
        private async Task Connect()
        {
            if (busy) return; SetBusy(true); bool failed = false;
            try
            {
                try
                {
                    Configuration config = SaveConfiguration();
                    string key = store.ReadKey(config.Selected.id);
                    if (key == null) throw new InvalidOperationException("请在“连接与设置”中填写 Runtime API key。");
                    Connection connection = config.RuntimeConnection();
                    if (PathRules.Within(connection.SelectedWorkspace.root, store.Root) ||
                        PathRules.Within(connection.SelectedWorkspace.root, Path.Combine(Application.StartupPath, "resources")))
                        throw new InvalidOperationException("主工作目录不能位于应用数据或运行包内。");
                    Window.Notify("正在应用工作区并连接…", false);
                    status = await runtime.Call("start", connection, key);
                    config.manuallyDisconnected = false; store.Save(config); Window.UpdateStatus(status);
                    Window.Notify("已应用当前工作区与共用目录权限。关闭窗口后可继续使用。", false);
                }
                catch (Exception error) { Report(error); failed = true; }
                if (failed) await ReadStatusAfterFailure();
            }
            finally { SetBusy(false); UpdateTray(); }
        }
        private async Task Disconnect(bool quit)
        {
            if (busy) return; SetBusy(true); bool failed = false;
            try
            {
                try
                {
                    if (runtime.Available) status = await runtime.Call("stop");
                    // Persist only the explicit disconnect preference; leave unsaved form edits available for review.
                    Configuration saved = store.Load(); saved.manuallyDisconnected = true; store.Save(saved);
                    Window.CollectConfiguration().manuallyDisconnected = true; Window.UpdateStatus(status);
                    Window.Notify("已断开。再次应用并连接前，自动连接暂停。", false);
                    if (quit) { exiting = true; timer.Stop(); Tray.Visible = false; Window.PermitClose = true; Window.Close(); ExitThread(); }
                }
                catch (Exception error) { Report(error); failed = true; }
                if (failed) await ReadStatusAfterFailure();
            }
            finally { if (!exiting) { SetBusy(false); UpdateTray(); } }
        }
        private async Task ReadStatusAfterFailure()
        {
            if (!runtime.Available) return;
            try { status = await runtime.Call("status"); Window.UpdateStatus(status); }
            catch { Tray.Text = "gpt-bridge · 状态查询失败"; }
        }
        private async Task Refresh()
        {
            if (busy || refreshing || exiting) return; refreshing = true;
            try
            {
                if (runtime.Available)
                {
                    RuntimeStatus value = await runtime.Call("status");
                    if (!busy && !exiting) { status = value; Window.UpdateStatus(status); UpdateTray(); }
                }
            }
            catch (Exception error) { if (!busy && !exiting) { Window.Notify(error.Message, true); Tray.Text = "gpt-bridge · 状态查询失败"; } }
            finally { refreshing = false; }
        }
        private void SetBusy(bool value) { busy = value; Window.SetBusy(value); }
        private void UpdateTray()
        {
            Tray.Icon = status.running && status.healthy && status.ready ? connectedIcon : disconnectedIcon;
            Tray.Text = "gpt-bridge · " + status.Label + (status.activeTasks > 0 ? " · 任务 " + status.activeTasks : "");
        }
        private void Report(Exception error) { Window.Notify(error.Message, true); Window.ShowSettings(); }
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                timer.Stop(); timer.Dispose(); Tray.Visible = false; Tray.Dispose(); menu.Dispose();
                Window.PermitClose = true; Window.Dispose(); connectedIcon.Dispose(); disconnectedIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
