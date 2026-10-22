using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Text;
using BehindRose.Windows;
using Microsoft.Win32.SafeHandles;

static class SafeFilesTests
{
    public static void Register(Action<string, Action> test)
    {
        test("File operations pin every ancestor against directory replacement until disposal", () =>
        {
            using var fixture = new Fixture();
            string parent = Path.Combine(fixture.Root, "parent"), child = Path.Combine(parent, "child");
            Directory.CreateDirectory(child);
            using (SafeFiles.LockParents(Path.Combine(child, "config.yaml")))
            {
                Refused(() => Directory.Move(child, child + "-moved"));
                Refused(() => Directory.Move(parent, parent + "-moved"));
                using var writer = CreateFileW(child, 0x40000000, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
                Require(writer.IsInvalid && Marshal.GetLastWin32Error() == 32);
            }
            Directory.Move(child, child + "-moved");
            Require(Directory.Exists(child + "-moved"));
        });
        test("File reads, writes and deletes refuse redirected ancestor directories", () =>
        {
            using var fixture = new Fixture();
            string target = Path.Combine(fixture.Root, "target"), link = Path.Combine(fixture.Root, "link");
            Directory.CreateDirectory(target);
            var bytes = Encoding.UTF8.GetBytes("original fixture contents");
            string original = Path.Combine(target, "config.yaml"); File.WriteAllBytes(original, bytes);
            var start = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (string arg in new[] { "/d", "/c", "mklink", "/J", link, target }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start)!; process.WaitForExit();
            Require(process.ExitCode == 0);
            try
            {
                string redirected = Path.Combine(link, "config.yaml");
                Refused(() => SafeFiles.Read(redirected));
                Refused(() => SafeFiles.AtomicWrite(redirected, Encoding.UTF8.GetBytes("replacement")));
                Refused(() => SafeFiles.Delete(redirected));
                Require(File.ReadAllBytes(original).SequenceEqual(bytes));
            }
            finally { Directory.Delete(link); }
        });
        test("Hard linked configuration files are rejected without altering either name", () =>
        {
            using var fixture = new Fixture();
            string original = Path.Combine(fixture.Root, "original.yaml"), link = Path.Combine(fixture.Root, "linked.yaml");
            byte[] bytes = Encoding.UTF8.GetBytes("fixture contents"); File.WriteAllBytes(original, bytes);
            Require(CreateHardLinkW(link, original, IntPtr.Zero));
            Refused(() => SafeFiles.Read(link));
            Refused(() => SafeFiles.AtomicWrite(link, Encoding.UTF8.GetBytes("replacement")));
            Require(File.ReadAllBytes(original).SequenceEqual(bytes) && File.ReadAllBytes(link).SequenceEqual(bytes));
        });
        test("Bounded atomic replacement and deletion release handles and leave no temporary files", () =>
        {
            using var fixture = new Fixture(); string file = Path.Combine(fixture.Root, "config.yaml");
            SafeFiles.AtomicWrite(file, [1, 2, 3], 3);
            Refused(() => SafeFiles.AtomicWrite(file, [4, 5, 6, 7], 3));
            Require(SafeFiles.Read(file, 3).SequenceEqual(new byte[] { 1, 2, 3 }));
            string permissions = new FileInfo(file).GetAccessControl(AccessControlSections.Access).GetSecurityDescriptorSddlForm(AccessControlSections.Access);
            SafeFiles.AtomicWrite(file, [7, 8], 3);
            Require(SafeFiles.Read(file, 3).SequenceEqual(new byte[] { 7, 8 }));
            Require(new FileInfo(file).GetAccessControl(AccessControlSections.Access).GetSecurityDescriptorSddlForm(AccessControlSections.Access) == permissions);
            Require(Directory.GetFiles(fixture.Root).Length == 1);
            SafeFiles.Delete(file); Require(!File.Exists(file));
        });
    }
    private static void Refused(Action action)
    {
        try { action(); } catch (IOException) { return; } catch (InvalidDataException) { return; } catch (UnauthorizedAccessException) { return; }
        throw new Exception("Unsafe file operation was accepted.");
    }
    private static void Require(bool condition) { if (!condition) throw new Exception("File safety assertion failed."); }
    private sealed class Fixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "behindrose-safe-files-" + Guid.NewGuid().ToString("N"));
        public Fixture() => Directory.CreateDirectory(Root);
        public void Dispose()
        {
            string full = Path.GetFullPath(Root);
            if (Path.GetDirectoryName(full) != Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar) || !Path.GetFileName(full).StartsWith("behindrose-safe-files-", StringComparison.Ordinal)) throw new IOException("Unexpected fixture path.");
            Directory.Delete(full, true);
        }
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string name, string existing, IntPtr security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, FileShare share, IntPtr security, uint disposition, uint flags, IntPtr template);
}
