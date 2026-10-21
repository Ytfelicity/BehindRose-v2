using System.Security.AccessControl;
using System.Security.Principal;
using BehindRose.Core;

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
        CheckPath(path);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > maxBytes) throw new InvalidDataException("文件超过允许大小。");
        byte[] bytes = new byte[file.Length]; file.ReadExactly(bytes); return bytes;
    }
    public static void AtomicWrite(string path, byte[] bytes) => AtomicWrite(path, bytes, Limit);
    public static void AtomicWrite(string path, byte[] bytes, int maxBytes)
    {
        if (maxBytes <= 0) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        if (bytes.Length > maxBytes) throw new InvalidDataException("文件超过允许大小，未写入该文件。");
        CheckPath(path);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { file.Write(bytes); file.Flush(true); }
            CheckPath(path);
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static void EnsureProtected(string path, string? sid, bool create)
    {
        CheckPath(path);
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
        var security = new DirectoryInfo(path).GetAccessControl();
        var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier ?? throw new IOException("无法核对备份目录所有者。");
        if (!owner.Equals(admins) && !owner.Equals(system)) throw new IOException("备份目录的所有者异常，未进行修改。");
        const FileSystemRights write = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && (rule.FileSystemRights & write) != 0 && !rule.IdentityReference.Equals(admins) && !rule.IdentityReference.Equals(system))
                throw new IOException("备份目录允许普通用户写入，未进行修改。");
    }
}
