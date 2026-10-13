using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace GptBridge
{
    public sealed class AccessDirectory
    {
        public string id { get; set; }
        public string path { get; set; }
        public string access { get; set; }
        public AccessDirectory() { id = Guid.NewGuid().ToString(); path = ""; access = "readOnly"; }
        public override string ToString() { return Path.GetFileName(path.TrimEnd('\\')); }
    }

    public sealed class Workspace
    {
        public string id { get; set; }
        public string root { get; set; }
        public string rootAccess { get; set; }
        public List<AccessDirectory> directories { get; set; }
        public bool allowCommands { get; set; }
        public Workspace() { id = Guid.NewGuid().ToString(); root = ""; rootAccess = "readWrite"; directories = new List<AccessDirectory>(); }
        public override string ToString() { return String.IsNullOrEmpty(root) ? "请选择主目录" : Path.GetFileName(root.TrimEnd('\\')); }
    }

    public sealed class Connection
    {
        public string id { get; set; }
        public string name { get; set; }
        public string tunnelID { get; set; }
        public List<Workspace> workspaces { get; set; }
        public string selectedWorkspaceID { get; set; }
        public Connection()
        {
            id = Guid.NewGuid().ToString(); name = "我的 Windows"; tunnelID = "";
            workspaces = new List<Workspace> { new Workspace() }; selectedWorkspaceID = workspaces[0].id;
        }
        [ScriptIgnore] public Workspace SelectedWorkspace { get { return workspaces.FirstOrDefault(w => w.id == selectedWorkspaceID); } }
        public override string ToString() { return name; }
    }

    public sealed class Configuration
    {
        public int schemaVersion { get; set; }
        public List<Connection> connections { get; set; }
        public List<AccessDirectory> sharedDirectories { get; set; }
        public string selectedID { get; set; }
        public bool connectOnLaunch { get; set; }
        public bool manuallyDisconnected { get; set; }
        public bool startAtLogin { get; set; }
        public Configuration()
        {
            schemaVersion = 2; connections = new List<Connection> { new Connection() };
            sharedDirectories = new List<AccessDirectory>(); selectedID = connections[0].id;
        }
        [ScriptIgnore] public Connection Selected { get { return connections.FirstOrDefault(c => c.id == selectedID); } }
        public Configuration Clone() { return Json.Read<Configuration>(Json.Write(this)); }
        public void Validate()
        {
            ValidateStructure();
            foreach (Connection c in connections)
            {
                c.name = c.name.Trim(); c.tunnelID = c.tunnelID.Trim();
                if (c.name.Length == 0 || c.name.Length > 80) throw new InvalidOperationException("连接名称需要 1–80 字。");
                if (!Regex.IsMatch(c.tunnelID, "^tunnel_[A-Za-z0-9]+$")) throw new InvalidOperationException("Tunnel ID 应以 tunnel_ 开头，仅包含英文字母和数字。");
                foreach (Workspace w in c.workspaces) w.root = PathRules.Directory(w.root);
            }
            foreach (AccessDirectory d in sharedDirectories) d.path = PathRules.Directory(d.path);
            if (sharedDirectories.Select(d => d.path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != sharedDirectories.Count)
                throw new InvalidOperationException("共用目录重复，请只保留一条权限规则。");
        }
        public void ValidateStructure()
        {
            if (schemaVersion != 2) throw new InvalidOperationException("配置版本不受支持，请使用匹配版本的 gpt-bridge。");
            if (connections == null || connections.Count == 0 || sharedDirectories == null || Selected == null)
                throw new InvalidOperationException("配置缺少有效的连接资料。");
            Guid unused;
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Connection c in connections)
            {
                if (c == null || !Guid.TryParse(c.id, out unused) || !ids.Add(c.id) || c.name == null || c.tunnelID == null ||
                    c.workspaces == null || c.workspaces.Count == 0 || c.SelectedWorkspace == null)
                    throw new InvalidOperationException("连接配置无效。");
                foreach (Workspace w in c.workspaces)
                    if (w == null || !Guid.TryParse(w.id, out unused) || !ids.Add(w.id) || w.root == null ||
                        !AccessValid(w.rootAccess) || w.directories == null || w.directories.Count != 0)
                        throw new InvalidOperationException("工作区配置无效，请在共用目录中统一管理权限。");
            }
            foreach (AccessDirectory d in sharedDirectories)
                if (d == null || !Guid.TryParse(d.id, out unused) || !ids.Add(d.id) || d.path == null || !AccessValid(d.access))
                    throw new InvalidOperationException("共用目录配置无效。");
        }
        private static bool AccessValid(string value) { return value == "readOnly" || value == "readWrite"; }
        public Connection RuntimeConnection()
        {
            Configuration copy = Clone(); copy.Validate();
            foreach (Workspace w in copy.Selected.workspaces)
            {
                w.directories = copy.sharedDirectories.Where(d => !PathRules.Equal(d.path, w.root)).ToList();
                AccessDirectory inherited = copy.sharedDirectories.Where(d => PathRules.Within(w.root, d.path))
                    .OrderByDescending(d => d.path.Length).FirstOrDefault();
                if (inherited != null && inherited.access == "readOnly") w.rootAccess = "readOnly";
            }
            return copy.Selected;
        }
    }

    public sealed class RuntimeStatus
    {
        public bool running { get; set; }
        public bool healthy { get; set; }
        public bool ready { get; set; }
        public int? pid { get; set; }
        public string activeID { get; set; }
        public string activeWorkspaceID { get; set; }
        public string activeWorkspaceRoot { get; set; }
        public int activeTasks { get; set; }
        public string error { get; set; }
        public string Label { get { return !running ? "未连接" : healthy && ready ? "已连接" : "连接尚未就绪"; } }
    }

    public static class Json
    {
        public static string Write(object value) { return new JavaScriptSerializer().Serialize(value); }
        public static T Read<T>(string value) { return new JavaScriptSerializer().Deserialize<T>(value); }
    }
}
