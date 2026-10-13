using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace GptBridge
{
    public sealed class RuntimeClient
    {
        private readonly string root;
        private readonly string resources;
        private readonly object gate = new object();
        public RuntimeClient(string dataRoot, string resourceRoot) { root = dataRoot; resources = resourceRoot; }
        public bool Available { get { return File.Exists(Path.Combine(resources, "runtime/bin/node.exe")) &&
            File.Exists(Path.Combine(resources, "runtime/bin/tunnel-client.exe")) && File.Exists(Path.Combine(resources, "bridge/control.mjs")); } }
        public Task<RuntimeStatus> Call(string action, Connection connection = null, string key = null)
        {
            return Task.Run(() =>
            {
                lock (gate)
                {
                    if (!Available) throw new InvalidOperationException("运行包不完整，请使用完整的 Windows ZIP 解压目录。");
                    var start = new ProcessStartInfo(Path.Combine(resources, "runtime/bin/node.exe"),
                        Quote(Path.Combine(resources, "bridge/control.mjs")) + " " + action + " " + Quote(root));
                    start.UseShellExecute = false; start.CreateNoWindow = true; start.WorkingDirectory = resources;
                    start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                    start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
                    start.EnvironmentVariables.Clear();
                    string system = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
                    string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    foreach (string name in new[] { "SystemRoot", "WINDIR" }) start.EnvironmentVariables[name] = system;
                    start.EnvironmentVariables["HOME"] = home; start.EnvironmentVariables["USERPROFILE"] = home;
                    start.EnvironmentVariables["PATH"] = Path.Combine(system, "System32") + ";" + system;
                    start.EnvironmentVariables["TEMP"] = Path.GetTempPath(); start.EnvironmentVariables["TMP"] = Path.GetTempPath();
                    if (key != null) start.EnvironmentVariables["MACBRIDGE_RUNTIME_KEY"] = key;
                    using (var process = Process.Start(start))
                    {
                        Task<string> output = process.StandardOutput.ReadToEndAsync();
                        Task<string> errors = process.StandardError.ReadToEndAsync();
                        // The JSON protocol is UTF-8 even on a Chinese Windows installation.
                        if (connection != null)
                        {
                            byte[] payload = Encoding.UTF8.GetBytes(Json.Write(connection));
                            process.StandardInput.BaseStream.Write(payload, 0, payload.Length);
                        }
                        process.StandardInput.Close();
                        if (!process.WaitForExit(150000))
                        {
                            process.Kill(); throw new InvalidOperationException("运行器操作超时，请查看当前连接状态后重试。");
                        }
                        string response = output.GetAwaiter().GetResult(); errors.GetAwaiter().GetResult();
                        RuntimeStatus result;
                        try { result = Json.Read<RuntimeStatus>(response); }
                        catch { throw new InvalidOperationException("运行器未返回有效状态，请检查完整应用目录。"); }
                        if (result == null) throw new InvalidOperationException("运行器没有返回状态。");
                        if (!String.IsNullOrEmpty(result.error)) throw new InvalidOperationException(result.error);
                        if (process.ExitCode != 0) throw new InvalidOperationException("运行器操作失败。");
                        return result;
                    }
                }
            });
        }
        internal static string Quote(string value)
        {
            // Windows CreateProcess quoting, including backslashes immediately before quotes/the closing quote.
            var result = new StringBuilder("\""); int slashes = 0;
            foreach (char c in value)
            {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
                else { result.Append('\\', slashes); result.Append(c); }
                slashes = 0;
            }
            result.Append('\\', slashes * 2); return result.Append('"').ToString();
        }
    }
}
