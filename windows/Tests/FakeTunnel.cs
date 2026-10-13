// Local test fixture only. This executable is never included in a distribution.
// It hosts the real permission proxy while replacing the network tunnel manager.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Runtime.InteropServices;

namespace GptBridge
{
    public static class FakeTunnel
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo
        {
            public int cb; public string reserved; public string desktop; public string title;
            public int x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
            public short showWindow, reservedSize; public IntPtr reservedPointer, input, output, error;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation { public IntPtr process, thread; public int pid, tid; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(string application, System.Text.StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation process);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        private static int DetachedHost(string root)
        {
            string exe = Process.GetCurrentProcess().MainModule.FileName;
            var startup = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)) }; ProcessInformation process;
            Environment.SetEnvironmentVariable("MACBRIDGE_RUNTIME_KEY", null);
            if (!CreateProcess(exe, new System.Text.StringBuilder(RuntimeClient.Quote(exe) + " __host " + RuntimeClient.Quote(root)),
                IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, null, ref startup, out process))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            CloseHandle(process.thread); CloseHandle(process.process); return process.pid;
        }
        public sealed class Record
        {
            public int pid { get; set; }
            public long started { get; set; }
            public string config_path { get; set; }
            public string target { get; set; }
        }
        public static int Main(string[] args)
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            try
            {
                if (args[0] == "__host") return Host(args[1]);
                string state = Environment.GetEnvironmentVariable("TUNNEL_CLIENT_STATE_DIR");
                string root = Directory.GetParent(state).FullName;
                string recordFile = Path.Combine(state, "fixture.json"); Directory.CreateDirectory(state);
                string verb = args[1];
                if (verb == "list") { Console.Write(Json.Write(new { aliases = File.Exists(recordFile) ? new[] { "gpt-bridge-windows" } : new string[0] })); return 0; }
                if (verb == "connect")
                {
                    string command = Option(args, "--mcp-command");
                    File.WriteAllText(Path.Combine(root, "fixture-command.txt"), command);
                    using (Process host = Process.GetProcessById(DetachedHost(root)))
                    {
                        File.WriteAllText(recordFile, Json.Write(new Record { pid = host.Id, started = host.StartTime.ToUniversalTime().Ticks,
                            config_path = Path.Combine(Option(args, "--profile-dir"), "desktop.yaml"), target = command }));
                    }
                    for (int i = 0; i < 150 && !File.Exists(Path.Combine(root, "sessions.json")); i++) Thread.Sleep(100);
                }
                Record record = File.Exists(recordFile) ? Json.Read<Record>(File.ReadAllText(recordFile)) : null;
                bool running = false;
                if (record != null)
                {
                    try
                    {
                        using (Process host = Process.GetProcessById(record.pid))
                        {
                            running = !host.HasExited && host.StartTime.ToUniversalTime().Ticks == record.started;
                            if (verb == "stop" && running) { host.Kill(); host.WaitForExit(); running = false; }
                        }
                    }
                    catch (ArgumentException) { }
                }
                Console.Write(Json.Write(new { config_path = record == null ? "" : record.config_path,
                    process_running = running, healthy = running, ready = running,
                    process = new { pid = record == null ? 0 : record.pid, target_value = record == null ? "" : record.target } }));
                return 0;
            }
            catch (Exception error)
            {
                string state = Environment.GetEnvironmentVariable("TUNNEL_CLIENT_STATE_DIR");
                if (!String.IsNullOrEmpty(state)) File.WriteAllText(Path.Combine(Directory.GetParent(state).FullName, "fixture-error.txt"), error.ToString());
                Console.Error.WriteLine(error.Message); return 1;
            }
        }
        private static string Option(string[] args, string name) { return args[Array.IndexOf(args, name) + 1]; }
        private static int Host(string root)
        {
            string resources = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), "../.."));
            string node = Path.Combine(resources, "runtime/bin/node.exe");
            var start = new ProcessStartInfo(node, RuntimeClient.Quote(Path.Combine(resources, "bridge/windows-launcher.mjs")) + " " + RuntimeClient.Quote(root))
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using (Process proxy = Process.Start(start))
            {
                proxy.StandardOutput.ReadToEndAsync(); proxy.StandardError.ReadToEndAsync();
                Process task = null;
                try
                {
                    while (!proxy.HasExited)
                    {
                        bool requested = File.Exists(Path.Combine(root, "task.request"));
                        if (requested && task == null)
                            task = Process.Start(new ProcessStartInfo(node, "-e \"setInterval(()=>{},1000)\"") { UseShellExecute = false, CreateNoWindow = true });
                        if (!requested && task != null) { task.Kill(); task.WaitForExit(); task.Dispose(); task = null; }
                        Thread.Sleep(100);
                    }
                }
                finally { if (task != null) { task.Kill(); task.Dispose(); } }
            }
            return 0;
        }
    }
}
