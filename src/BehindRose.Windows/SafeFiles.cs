using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using BehindRose.Core;
using Microsoft.Win32.SafeHandles;

namespace BehindRose.Windows;

public static class SafeFiles
{
    public const int Limit = 16 * 1024 * 1024;
    public static void CheckPath(string path)
    {
        for (string? current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current))
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("暂不操作链接或重定向目录：" + Path.GetFileName(current));
    }
    public static byte[] Read(string path) => Read(path, Limit);
    public static byte[] Read(string path, int maxBytes)
    {
        if (maxBytes <= 0) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        using var parents = LockParents(path);
        using var handle = OpenCheckedFile(path, 0x80000000, FileShare.Read);
        using var file = new FileStream(handle, FileAccess.Read);
        if (file.Length > maxBytes) throw new InvalidDataException("文件超过允许大小。");
        byte[] bytes = new byte[file.Length]; file.ReadExactly(bytes); return bytes;
    }
    public static void AtomicWrite(string path, byte[] bytes) => AtomicWrite(path, bytes, Limit);
    public static void AtomicWrite(string path, byte[] bytes, int maxBytes)
    {
        if (maxBytes <= 0) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        if (bytes.Length > maxBytes) throw new InvalidDataException("文件超过允许大小，未写入该文件。");
        using var parents = LockParents(path);
        FileSecurity? permissions = null;
        if (File.Exists(path))
        {
            using var existing = OpenCheckedFile(path, 0x80000000, FileShare.Read | FileShare.Delete);
            using var original = new FileStream(existing, FileAccess.Read);
            permissions = original.GetAccessControl();
        }
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var handle = OpenNative(temp, 0x40000000 | 0x00010000 | 0x00040000, FileShare.None, 0x80000000 | 0x00200000, 1))
            using (var file = new FileStream(handle, FileAccess.Write, 4096))
            {
                if (permissions != null) file.SetAccessControl(permissions);
                file.Write(bytes); file.Flush(true);
                RenameWithinDirectory(handle, Path.GetFileName(path));
            }
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static void Delete(string path)
    {
        using var parents = LockParents(path);
        // DeleteFile removes a final symbolic link itself; ancestors stay pinned.
        File.Delete(path);
    }

    // Keep every ancestor open until the I/O finishes. A path check by itself
    // cannot stop another process renaming a checked directory into a junction.
    internal static IDisposable LockParents(string path)
    {
        string full = Path.GetFullPath(path);
        string root = Path.GetPathRoot(full) ?? throw new IOException("文件路径无效。");
        if (root.Length != 3 || root[1] != ':' || full[root.Length..].Contains(':')) throw new IOException("只支持本机普通文件路径。");
        var lease = new DirectoryLease();
        try
        {
            string current = root;
            lease.Add(OpenDirectory(current));
            foreach (string segment in Path.GetRelativePath(root, Path.GetDirectoryName(full)!).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
            {
                if (segment == ".") continue;
                current = Path.Combine(current, segment);
                lease.Add(OpenDirectory(current));
            }
            return lease;
        }
        catch { lease.Dispose(); throw; }
    }
    private static SafeFileHandle OpenDirectory(string path)
    {
        // Attribute-only handles do not participate in Windows sharing checks.
        var handle = OpenNative(path, 0x80000000, FileShare.Read, 0x02000000 | 0x00200000);
        try
        {
            var info = Information(handle);
            if ((info.Attributes & FileAttributes.Directory) == 0 || (info.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("暂不操作链接或重定向目录。");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static SafeFileHandle OpenCheckedFile(string path, uint access, FileShare share)
    {
        var handle = OpenNative(path, access, share, 0x00200000);
        try
        {
            var info = Information(handle);
            if ((info.Attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0 || info.Links != 1) throw new IOException("暂不操作链接或重定向文件。");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static SafeFileHandle OpenNative(string path, uint access, FileShare share, uint flags, uint disposition = 3)
    {
        var handle = CreateFileW(path, access, share, IntPtr.Zero, disposition, flags, IntPtr.Zero);
        if (!handle.IsInvalid) return handle;
        int error = Marshal.GetLastWin32Error(); handle.Dispose();
        throw new IOException("无法安全打开文件或目录。", new Win32Exception(error));
    }
    private static void RenameWithinDirectory(SafeFileHandle file, string name)
    {
        // A simple name with no RootDirectory renames the open file within its
        // existing directory. No source/target ancestor is reopened by path.
        // Keep the temporary file handle open so its name cannot be substituted.
        byte[] bytes = System.Text.Encoding.Unicode.GetBytes(name);
        int nameOffset = Marshal.OffsetOf<RenameInformation>(nameof(RenameInformation.Name)).ToInt32();
        int size = Math.Max(Marshal.SizeOf<RenameInformation>(), nameOffset + bytes.Length + 2);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(new RenameInformation { Replace = 1, Root = IntPtr.Zero, NameLength = (uint)bytes.Length }, buffer, false);
            Marshal.Copy(bytes, 0, buffer + nameOffset, bytes.Length); Marshal.WriteInt16(buffer, nameOffset + bytes.Length, 0);
            int status = NtSetInformationFile(file, out _, buffer, (uint)size, 10);
            if (status < 0) throw new IOException("无法安全替换配置文件。", new Win32Exception((int)RtlNtStatusToDosError(status)));
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static FileInformation Information(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var info)) throw new IOException("无法核对文件句柄。", new Win32Exception(Marshal.GetLastWin32Error()));
        return info;
    }
    private sealed class DirectoryLease : IDisposable
    {
        private readonly List<SafeFileHandle> handles = [];
        public void Add(SafeFileHandle handle) => handles.Add(handle);
        public void Dispose() { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); handles.Clear(); }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public FileAttributes Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct RenameInformation { public uint Replace; public IntPtr Root; public uint NameLength; public char Name; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, FileShare share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    [StructLayout(LayoutKind.Sequential)]
    private struct IoStatusBlock { public IntPtr Status; public UIntPtr Information; }
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int NtSetInformationFile(SafeFileHandle file, out IoStatusBlock ioStatus, IntPtr information, uint size, int informationClass);
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern uint RtlNtStatusToDosError(int status);
    public static void EnsureProtected(string path, string? sid, bool create)
    {
        using var parents = LockParents(path);
        var admins = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        if (!Directory.Exists(path))
        {
            if (!create) return;
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(admins);
            var inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            acl.AddAccessRule(new FileSystemAccessRule(admins, FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(system, FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(sid is null ? new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null) : new SecurityIdentifier(sid), FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(path).Create(acl);
        }
        using var directory = OpenDirectory(path);
        var security = new DirectoryInfo(path).GetAccessControl();
        var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier ?? throw new IOException("无法核对备份目录所有者。");
        if (!owner.Equals(admins) && !owner.Equals(system)) throw new IOException("备份目录的所有者异常，未进行修改。");
        const FileSystemRights write = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & write) != 0 && !rule.IdentityReference.Equals(admins) && !rule.IdentityReference.Equals(system))
                throw new IOException("备份目录允许普通用户写入，未进行修改。");
    }
}
