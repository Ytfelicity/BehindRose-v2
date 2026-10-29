using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace BehindRose.Windows;

/// <summary>Windows DPAPI, current-user scope, with UI disabled. No plaintext backup files.</summary>
public sealed class ClaudeConfigurationDpapiProtector : IClaudeBackupProtector
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Blob { public int Length; public IntPtr Data; }

    public byte[] Protect(byte[] plaintext) => Transform(plaintext, true);
    public byte[] Unprotect(byte[] ciphertext) => Transform(ciphertext, false);

    private static byte[] Transform(byte[] input, bool protect)
    {
        if (input.Length > 4 * 1024 * 1024) throw new CryptographicException("配置备份超过允许大小。");
        var source = new Blob { Length = input.Length, Data = Marshal.AllocHGlobal(Math.Max(input.Length, 1)) };
        Blob output = default;
        IntPtr description = IntPtr.Zero;
        try
        {
            Marshal.Copy(input, 0, source.Data, input.Length);
            bool ok = protect
                ? CryptProtectData(ref source, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref source, out description, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!ok) throw new CryptographicException("Windows 无法加密或解密这份用户配置备份。", new Win32Exception(Marshal.GetLastWin32Error()));
            if (output.Length is < 0 or > 4 * 1024 * 1024) throw new CryptographicException("加密配置备份大小无效。");
            byte[] result = new byte[output.Length]; Marshal.Copy(output.Data, result, 0, output.Length); return result;
        }
        finally
        {
            Clear(source.Data, source.Length); Marshal.FreeHGlobal(source.Data);
            if (output.Data != IntPtr.Zero) { Clear(output.Data, output.Length); _ = LocalFree(output.Data); }
            if (description != IntPtr.Zero) _ = LocalFree(description);
        }
    }
    private static void Clear(IntPtr pointer, int length)
    {
        if (pointer == IntPtr.Zero || length <= 0 || length > 4 * 1024 * 1024) return;
        byte[] zero = new byte[Math.Min(length, 4096)];
        for (int position = 0; position < length; position += zero.Length)
            Marshal.Copy(zero, 0, pointer + position, Math.Min(zero.Length, length - position));
    }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref Blob input, out IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr pointer);
}
