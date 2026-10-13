using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
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
                using (var context = new TrayApplicationContext(store, new RuntimeClient(store.Root, root), true))
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
                    for (int i = 0; i < tabs.TabCount; i++)
                    {
                        tabs.SelectedIndex = i; form.PerformLayout(); Application.DoEvents();
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
