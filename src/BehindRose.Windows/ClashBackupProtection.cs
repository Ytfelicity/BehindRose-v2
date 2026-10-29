using System.Security.Cryptography;
using System.Text;

namespace BehindRose.Windows;

public interface IClashBackupProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] ciphertext);
}

// Encrypt the archive with a fresh AES key, then wrap that small key using the
// existing current-user Windows DPAPI implementation. No plaintext export file.
public sealed class ClashBackupDpapiProtector : IClashBackupProtector
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("BRCLASH1");
    public byte[] Protect(byte[] plaintext)
    {
        byte[] key = RandomNumberGenerator.GetBytes(32);
        try
        {
            byte[] wrapped = new ClaudeConfigurationDpapiProtector().Protect(key);
            int headerLength = 12 + wrapped.Length + 12;
            byte[] result = new byte[headerLength + 16 + plaintext.Length];
            Magic.CopyTo(result, 0); BitConverter.GetBytes(wrapped.Length).CopyTo(result, 8);
            wrapped.CopyTo(result, 12); RandomNumberGenerator.Fill(result.AsSpan(headerLength - 12, 12));
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(result.AsSpan(headerLength - 12, 12), plaintext, result.AsSpan(headerLength + 16), result.AsSpan(headerLength, 16), result.AsSpan(0, headerLength));
            return result;
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }
    public byte[] Unprotect(byte[] ciphertext)
    {
        if (ciphertext.Length < 40 || !ciphertext.AsSpan(0, 8).SequenceEqual(Magic)) throw new CryptographicException("完整备份格式无效。");
        int length = BitConverter.ToInt32(ciphertext, 8);
        if (length is < 1 or > 8192 || ciphertext.Length < 12 + length + 28) throw new CryptographicException("完整备份格式无效。");
        byte[] key = new ClaudeConfigurationDpapiProtector().Unprotect(ciphertext.AsSpan(12, length).ToArray());
        try
        {
            int headerLength = 12 + length + 12;
            byte[] result = new byte[ciphertext.Length - headerLength - 16];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(ciphertext.AsSpan(headerLength - 12, 12), ciphertext.AsSpan(headerLength + 16), ciphertext.AsSpan(headerLength, 16), result, ciphertext.AsSpan(0, headerLength));
            return result;
        }
        finally { CryptographicOperations.ZeroMemory(key); }
    }
}
