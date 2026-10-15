using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace GptBridge
{
    public static class PathRules
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
        public static bool Equal(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
        public static bool Within(string value, string root) { return Equal(value, root) || value.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase); }
        public static string Directory(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0 ||
                !System.Text.RegularExpressions.Regex.IsMatch(value, "^[A-Za-z]:[\\\\/]") || value.Substring(2).Contains(":"))
                throw new InvalidOperationException("请选择本地磁盘上的文件夹，不能选择整个磁盘或网络路径。");
            string full = Path.GetFullPath(value);
            if (!System.IO.Directory.Exists(full)) throw new InvalidOperationException("目录不存在或无法访问，请重新选择。");
            using (SafeFileHandle handle = CreateFile(full, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
            {
                var result = new StringBuilder(32768);
                uint length = handle.IsInvalid ? 0 : GetFinalPathNameByHandle(handle, result, (uint)result.Capacity, 0);
                if (length == 0 || length >= result.Capacity) throw new InvalidOperationException("无法确认文件夹的实际路径。");
                full = result.ToString();
                if (full.StartsWith("\\\\?\\")) full = full.Substring(4);
            }
            if (!System.Text.RegularExpressions.Regex.IsMatch(full, "^[A-Za-z]:\\\\") || Equal(full.TrimEnd('\\'), Path.GetPathRoot(full).TrimEnd('\\')))
                throw new InvalidOperationException("不能选择整个磁盘或网络目录。");
            return full.TrimEnd('\\');
        }
    }

    public sealed class ConfigurationStore
    {
        public string Root { get; private set; }
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("gpt-bridge.windows.runtime.v1");
        public ConfigurationStore(string root)
        {
            Root = root; System.IO.Directory.CreateDirectory(root);
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("应用数据目录不能是链接。");
            var user = WindowsIdentity.GetCurrent().User;
            var acl = new DirectorySecurity(); acl.SetOwner(user); acl.SetAccessRuleProtection(true, false);
            foreach (SecurityIdentifier sid in new[] { user, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            System.IO.Directory.SetAccessControl(root, acl);
        }
        public Configuration Load()
        {
            string file = Path.Combine(Root, "connections.json");
            if (!File.Exists(file)) return new Configuration();
            Configuration config = Json.Read<Configuration>(File.ReadAllText(file, Encoding.UTF8));
            if (config == null) throw new InvalidOperationException("配置文件无效。");
            config.ValidateStructure(); return config;
        }
        public void Save(Configuration config) { config.ValidateStructure(); Atomic(Path.Combine(Root, "connections.json"), Encoding.UTF8.GetBytes(Json.Write(config))); }
        public void SaveKey(string id, string key)
        {
            if (String.IsNullOrWhiteSpace(key) || key.IndexOfAny(new[] { '\n', '\r', '\0' }) >= 0)
                throw new InvalidOperationException("Runtime key 格式无效。");
            byte[] clear = Encoding.UTF8.GetBytes(key.Trim());
            try { Atomic(KeyPath(id), ProtectedData.Protect(clear, Entropy, DataProtectionScope.CurrentUser)); }
            finally { Array.Clear(clear, 0, clear.Length); }
        }
        public string ReadKey(string id)
        {
            string file = KeyPath(id); if (!File.Exists(file)) return null;
            byte[] clear = ProtectedData.Unprotect(File.ReadAllBytes(file), Entropy, DataProtectionScope.CurrentUser);
            try { return Encoding.UTF8.GetString(clear); }
            finally { Array.Clear(clear, 0, clear.Length); }
        }
        public bool HasKey(string id) { return File.Exists(KeyPath(id)); }
        private string KeyPath(string id)
        {
            Guid unused; if (!Guid.TryParse(id, out unused)) throw new InvalidOperationException("连接标识无效。");
            string dir = Path.Combine(Root, "credentials"); System.IO.Directory.CreateDirectory(dir);
            return Path.Combine(dir, id + ".bin");
        }
        internal static void Atomic(string file, byte[] bytes)
        {
            if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("应用配置不能是链接。");
            string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }

    public static class StartupManager
    {
        public static void Set(bool enabled)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            {
                if (enabled) key.SetValue("gpt-bridge", "\"" + System.Windows.Forms.Application.ExecutablePath + "\" --background");
                else key.DeleteValue("gpt-bridge", false);
            }
        }
    }
}
