using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace GptBridge
{
    public sealed class MethodLibraryConfiguration
    {
        public int schemaVersion { get; set; }
        public List<string> directories { get; set; }
    }
    public sealed class MethodDocument
    {
        public string title { get; set; }
        public string preview { get; set; }
        public string library_path { get; set; }
        public string document_path { get; set; }
        public string Identity { get { return library_path + "\n" + document_path; } }
    }
    public sealed class MethodDirectoryError
    {
        public string path { get; set; }
        public string error { get; set; }
    }
    public sealed class MethodSearchResponse
    {
        public List<MethodDocument> results { get; set; }
        public int matched { get; set; }
        public int? nextOffset { get; set; }
        public bool incomplete { get; set; }
        public int skipped { get; set; }
        public List<MethodDirectoryError> errors { get; set; }
    }
    public sealed class MethodReadResponse
    {
        public string text { get; set; }
        public int? nextOffset { get; set; }
    }
    public sealed class MethodLibraryStore
    {
        private readonly string file;
        private readonly string[] protectedPaths;
        public List<string> Directories { get; private set; }
        public MethodLibraryStore(string dataRoot, string resources)
        {
            file = Path.Combine(dataRoot, "method-library.json");
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            protectedPaths = new[] { dataRoot, resources, Path.Combine(home, ".config/macbridge"),
                Path.Combine(home, ".local/share/macbridge"), Path.Combine(home, "AppData/Roaming/Microsoft/Credentials"),
                Path.Combine(home, "AppData/Local/Microsoft/Credentials") }.Select(Path.GetFullPath).ToArray();
            Directories = new List<string>();
            if (!File.Exists(file)) return;
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("方法库配置不能是链接。");
            var saved = Json.Read<MethodLibraryConfiguration>(File.ReadAllText(file, Encoding.UTF8));
            if (saved == null || saved.schemaVersion != 1 || saved.directories == null || saved.directories.Count > 30 || saved.directories.Any(String.IsNullOrWhiteSpace))
                throw new InvalidOperationException("方法库配置无效或版本不支持，原文件已保留。");
            Directories = saved.directories.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }
        public void Add(string directory)
        {
            string actual = PathRules.Directory(directory);
            if (protectedPaths.Any(p => PathRules.Within(actual, p) || PathRules.Within(p, actual)))
                throw new InvalidOperationException("请选择具体资料文件夹，不要选择应用数据、凭据或运行包目录及其上级目录。");
            if (Directories.Any(p => PathRules.Equal(p, actual))) return;
            if (Directories.Count >= 30) throw new InvalidOperationException("最多添加 30 个资料目录。");
            Save(Directories.Concat(new[] { actual }).OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToList());
        }
        public void Remove(string directory) { Save(Directories.Where(p => !PathRules.Equal(p, directory)).ToList()); }
        private void Save(List<string> paths)
        {
            ConfigurationStore.Atomic(file, new UTF8Encoding(false).GetBytes(Json.Write(new MethodLibraryConfiguration { schemaVersion = 1, directories = paths })));
            Directories = paths;
        }
    }
}
