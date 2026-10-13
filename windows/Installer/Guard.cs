using System;
using System.Security.Principal;
using System.Threading;

// A separate helper lets Setup check the existing (including portable) app
// without starting it, reading its configuration, or interrupting its tunnel.
internal static class InstallerGuard
{
    public static int Main()
    {
        try
        {
#if INSTALLER_TEST
            string name = @"Local\gpt-bridge.installer-test";
#else
            string name = @"Local\gpt-bridge." + WindowsIdentity.GetCurrent().User.Value;
#endif
            Mutex mutex;
            if (!Mutex.TryOpenExisting(name, out mutex)) return 0;
            mutex.Dispose();
            return 1;
        }
        catch { return 2; } // Fail closed if process ownership cannot be checked.
    }
}
