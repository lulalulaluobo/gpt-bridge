using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace GptBridge
{
    public static class WindowsTests
    {
        private static int checks;
        private static void Check(bool value, string message) { if (!value) throw new Exception(message); checks++; }
        private static void Denied(Action action) { bool failed = false; try { action(); } catch { failed = true; } Check(failed, "Expected rejection"); }
        private static T Field<T>(object target, string name) { return (T)target.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(target); }
        [STAThread] public static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--echo") { Console.OutputEncoding = new UTF8Encoding(false); Console.Write(Json.Write(args.Skip(1).ToArray())); return 0; }
            string root = Path.Combine(Path.GetTempPath(), "gpt-bridge-windows-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                var store = new ConfigurationStore(Path.Combine(root, "private"));
                Configuration config = store.Load();
                string folder = Path.Combine(root, "项目's % & folder"); Directory.CreateDirectory(folder);
                config.Selected.tunnelID = "tunnel_Test123"; config.Selected.SelectedWorkspace.root = folder;
                config.sharedDirectories.Add(new AccessDirectory { path = folder, access = "readOnly" });
                config.Validate(); store.Save(config); store.Save(config);
                Check(store.Load().Selected.SelectedWorkspace.root == folder, "Unicode config round trip");
                Check(!Directory.GetFiles(store.Root, "*.tmp").Any(), "Atomic saves left temporary files");
                Check(!Json.Write(config).Contains("\"SelectedWorkspace\":") && !Json.Write(config).Contains("\"Selected\":"), "Derived model properties leaked into stored JSON");
                Configuration copied = config.Clone(); copied.Selected.name = "changed";
                Check(config.Selected.name != copied.Selected.name, "Clone was not independent");
                Check(config.RuntimeConnection().SelectedWorkspace.rootAccess == "readOnly", "Selecting shared read-only root raised permission");
                Check(config.RuntimeConnection().SelectedWorkspace.directories.Count == 0, "Root was duplicated in grants");
                string nested = Path.Combine(folder, "nested"); Directory.CreateDirectory(nested);
                copied.Selected.SelectedWorkspace.root = nested;
                Check(copied.RuntimeConnection().SelectedWorkspace.rootAccess == "readOnly", "Read-only inheritance lost on subtree");
                copied.schemaVersion = 99; Denied(copied.ValidateStructure);
                copied = config.Clone(); copied.sharedDirectories.Add(new AccessDirectory { path = folder.ToUpperInvariant() }); Denied(copied.Validate);
                Denied(delegate { PathRules.Directory(Path.GetPathRoot(folder)); });
                Denied(delegate { PathRules.Directory(@"\\server\share"); });
                Denied(delegate { PathRules.Directory(folder + ":hidden"); });
                Check(PathRules.Equal(PathRules.Directory(folder), folder), "Canonical local folder changed");
                string resources = args.Length == 2 && args[0] == "--resources" ? args[1] : Path.Combine(root, "runtime");
                var library = new MethodLibraryStore(store.Root, resources);
                library.Add(folder); library.Add(folder.ToUpperInvariant());
                Check(library.Directories.Count == 1, "Method directories were not deduplicated");
                Check(new MethodLibraryStore(store.Root, resources).Directories.Single() == folder, "Method directory round trip failed");
                Denied(delegate { library.Add(store.Root); });
                Denied(delegate { library.Add(root); });
                Denied(delegate { library.Add(Path.GetPathRoot(folder)); });
                Check(store.Load().sharedDirectories.Count == 1 && store.Load().Selected.SelectedWorkspace.allowCommands == false, "Method authorization changed workspace permissions");
                string methodFile = Path.Combine(folder, "SKILL.md"); File.WriteAllText(methodFile, "readonly-reference", new UTF8Encoding(false));
                library.Remove(folder); Check(File.Exists(methodFile) && library.Directories.Count == 0, "Removing method access deleted documents");
                if (args.Length == 2)
                {
                    for (int i = 0; i < 24; i++)
                    {
                        string method = Path.Combine(folder, "method-" + i); Directory.CreateDirectory(method);
                        File.WriteAllText(Path.Combine(method, "SKILL.md"), "---\nname: 方法 " + i + "\ndescription: 中文写作\n---\n" + String.Join("\n", Enumerable.Range(0, 250).Select(n => "line-" + n)), new UTF8Encoding(false));
                    }
                    library.Add(folder);
                    var methodClient = new RuntimeClient(store.Root, resources);
                    MethodSearchResponse first = methodClient.QueryMethods<MethodSearchResponse>(new { action = "search", query = "中文", limit = 20 }).GetAwaiter().GetResult();
                    Check(first.matched == 24 && first.results.Count == 20 && first.nextOffset == 20, "Packaged method search or UTF-8 input failed");
                    MethodSearchResponse second = methodClient.QueryMethods<MethodSearchResponse>(new { action = "search", query = "中文", offset = first.nextOffset.Value }).GetAwaiter().GetResult();
                    Check(second.results.Count == 4 && second.nextOffset == null, "Packaged search paging failed");
                    MethodDocument row = first.results[0];
                    MethodReadResponse page = methodClient.QueryMethods<MethodReadResponse>(new { action = "read", row.library_path, row.document_path, length = 100 }).GetAwaiter().GetResult();
                    Check(page.text.Contains("中文写作") && page.nextOffset == 100, "Packaged method reading or UTF-8 output failed");
                    library.Remove(folder);
                    Denied(delegate { methodClient.QueryMethods<MethodReadResponse>(new { action = "read", row.library_path, row.document_path }).GetAwaiter().GetResult(); });
                    library.Add(folder);
                }
                string libraryFile = Path.Combine(store.Root, "method-library.json"); string originalLibrary = File.ReadAllText(libraryFile);
                File.WriteAllText(libraryFile, "{broken"); Denied(delegate { new MethodLibraryStore(store.Root, resources); });
                Check(File.ReadAllText(libraryFile) == "{broken", "Corrupt method config was overwritten");
                File.WriteAllText(libraryFile, originalLibrary, new UTF8Encoding(false));
                string secret = "synthetic-key-for-test-only-" + Guid.NewGuid(); store.SaveKey(config.Selected.id, secret);
                Check(store.ReadKey(config.Selected.id) == secret, "DPAPI round trip failed");
                string keyFile = Directory.GetFiles(Path.Combine(store.Root, "credentials"))[0];
                Check(!Encoding.UTF8.GetString(File.ReadAllBytes(keyFile)).Contains(secret), "Plaintext key was persisted");
                Check(!File.ReadAllText(Path.Combine(store.Root, "connections.json")).Contains(secret), "Key leaked into connections JSON");
                var acl = Directory.GetAccessControl(store.Root);
                Check(acl.AreAccessRulesProtected, "Private directory inherits broad ACL");
                string user = WindowsIdentity.GetCurrent().User.Value;
                Check(acl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
                    .All(rule => rule.AccessControlType != AccessControlType.Allow || rule.IdentityReference.Value == user || rule.IdentityReference.Value == "S-1-5-18"), "Private directory is accessible to another account");
                string[] special = { "folder with space", "中文's % & path", @"C:\ending\", "a\"b", "" };
                var start = new ProcessStartInfo(Application.ExecutablePath, "--echo " + String.Join(" ", special.Select(RuntimeClient.Quote))) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, StandardOutputEncoding = Encoding.UTF8 };
                using (Process echo = Process.Start(start))
                { string output = echo.StandardOutput.ReadToEnd(); echo.WaitForExit(); Check(Json.Read<string[]>(output).SequenceEqual(special), "CreateProcess quoting altered arguments"); }
                using (var context = new TrayApplicationContext(store, new RuntimeClient(store.Root, resources), true))
                {
                    MainForm form = context.Window;
                    Check(context.Tray.Visible && !form.Visible, "Background startup is not tray-only");
                    Check(form.ShowInTaskbar, "Settings window has no taskbar entry");
                    Check(context.Tray.ContextMenuStrip.Items.Cast<ToolStripItem>().Any(i => i.Text == "断开并退出"), "Tray actions missing");
                    Field<TextBox>(form, "connectionName").Text = "未保存名称";
                    Field<TextBox>(form, "secret").Text = "draft-secret";
                    form.SelectWorkspace(config.Selected.selectedWorkspaceID);
                    Check(form.CollectConfiguration().Selected.name == "未保存名称", "Workspace selection discarded unsaved connection fields");
                    Check(Field<TextBox>(form, "secret").Text == "draft-secret", "Workspace selection discarded draft key");
                    form.Saved(); Check(form.PendingKeys.Count == 0 && Field<TextBox>(form, "secret").Text == "", "Saved key stayed in input");
                    form.SetBusy(true); Check(!Field<TabControl>(form, "tabs").Enabled && !Field<Button>(form, "connect").Enabled, "Mutations enabled during runtime operation"); form.SetBusy(false);
                    form.UpdateStatus(new RuntimeStatus { running = true, healthy = true, ready = true, activeWorkspaceRoot = folder, activeTasks = 1 });
                    Check(Field<Label>(form, "status").Text.Contains("活动任务 1"), "Task status is hidden");
                    // Render the actual controls off-screen; keep the user's desktop undisturbed.
                    form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-32000, -32000); form.Opacity = 0;
                    form.ShowSettings(); Application.DoEvents();
                    Check(form.Visible, "Tray activation did not show settings");
                    string outputDirectory = Path.GetDirectoryName(Application.ExecutablePath);
                    TabControl tabs = Field<TabControl>(form, "tabs");
                    Check(tabs.TabPages.Cast<TabPage>().Any(p => p.Text == "方法库"), "Method library page missing");
                    for (int i = 0; i < tabs.TabCount; i++)
                    {
                        tabs.SelectedIndex = i; form.PerformLayout(); Application.DoEvents();
                        if (args.Length == 2 && tabs.SelectedTab.Text == "方法库")
                        {
                            MethodLibraryControl panel = tabs.SelectedTab.Controls.OfType<MethodLibraryControl>().Single();
                            var watch = Stopwatch.StartNew();
                            while (Field<bool>(panel, "busy") && watch.ElapsedMilliseconds < 30000) { Application.DoEvents(); Thread.Sleep(20); }
                            Check(Field<DataGridView>(panel, "documents").Rows.Count == 20 && Field<Button>(panel, "more").Visible, "Method page did not display paged results");
                            Button moreButton = Field<Button>(panel, "more"); panel.PerformLayout(); Application.DoEvents();
                            Check(moreButton.Parent.ClientRectangle.Contains(moreButton.Bounds), "Method paging button is clipped: " + moreButton.Bounds + " parent " + moreButton.Parent.ClientSize);
                            foreach (Button action in Field<System.Collections.Generic.List<Control>>(panel, "actions").OfType<Button>().Where(b => b.Visible))
                                Check(action.Parent.ClientRectangle.Contains(action.Bounds), "Method action is clipped: " + action.Text);
                            MethodDocument selected = (MethodDocument)Field<DataGridView>(panel, "documents").Rows[0].Tag;
                            using (var preview = new MethodPreviewForm(new RuntimeClient(store.Root, resources), selected))
                            {
                                preview.StartPosition = FormStartPosition.Manual; preview.Location = new Point(-32000, -32000); preview.Opacity = 0;
                                preview.Show(); Application.DoEvents(); watch.Restart();
                                while (Field<bool>(preview, "busy") && watch.ElapsedMilliseconds < 30000) { Application.DoEvents(); Thread.Sleep(20); }
                                Check(Field<TextBox>(preview, "content").Text.Length > 0, "Method preview did not load: " + Field<Label>(preview, "notice").Text);
                                Check(Field<TextBox>(preview, "content").SelectionStart == 0, "Method preview did not start at the first line");
                                Button readMore = Field<Button>(preview, "more");
                                Check(readMore.Parent.ClientRectangle.Contains(readMore.Bounds), "Preview read-more button is clipped");
                                int previousLength = Field<TextBox>(preview, "content").TextLength;
                                readMore.PerformClick(); Application.DoEvents(); watch.Restart();
                                while (Field<bool>(preview, "busy") && watch.ElapsedMilliseconds < 30000) { Application.DoEvents(); Thread.Sleep(20); }
                                Check(Field<TextBox>(preview, "content").TextLength > previousLength, "Preview did not append the next page");
                                preview.Close();
                            }
                        }
                        using (var bitmap = new Bitmap(form.Width, form.Height))
                        { form.DrawToBitmap(bitmap, new Rectangle(0, 0, bitmap.Width, bitmap.Height)); bitmap.Save(Path.Combine(outputDirectory, "preview-" + i + ".png")); }
                    }
                    form.Close(); Application.DoEvents();
                    Check(!form.Visible && !form.IsDisposed && context.Tray.Visible, "Closing settings terminated the resident app");
                    form.ShowSettings(); form.WindowState = FormWindowState.Minimized; Application.DoEvents();
                    Check(!form.Visible && context.Tray.Visible, "Minimize did not retain tray app");
                }
                // Never replace a corrupt configuration with an empty default.
                string file = Path.Combine(store.Root, "connections.json"); File.WriteAllText(file, "{broken"); Denied(delegate { store.Load(); });
                Check(File.ReadAllText(file) == "{broken", "Corrupt config was silently overwritten");
                Console.WriteLine(Json.Write(new { passed = true, checks = checks, dpapi = true, privateACL = true, trayLifecycle = true, formPreviews = true }));
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
            finally
            {
                string resolved = Path.GetFullPath(root);
                if (resolved.StartsWith(Path.Combine(Path.GetTempPath(), "gpt-bridge-windows-test-"), StringComparison.OrdinalIgnoreCase)) Directory.Delete(resolved, true);
            }
        }
    }
}
