using System.Reflection;
using System.Reflection.PortableExecutable;
using BehindRose.Core;
using BehindRose.Windows;

static class ReleaseMetadataTests
{
    public static void Register(Action<string, Action> test)
    {
        test("Release assemblies keep local checkout paths out of CodeView metadata", () =>
        {
            if (typeof(ReleaseMetadataTests).Assembly.GetCustomAttribute<AssemblyConfigurationAttribute>()?.Configuration != "Release") return;
            foreach (var assembly in new[] { typeof(RepairPlanner).Assembly, typeof(WindowsState).Assembly, typeof(ReleaseMetadataTests).Assembly })
            {
                using var stream = File.OpenRead(assembly.Location);
                using var pe = new PEReader(stream);
                foreach (var entry in pe.ReadDebugDirectory().Where(entry => entry.Type == DebugDirectoryEntryType.CodeView))
                {
                    string path = pe.ReadCodeViewDebugDirectoryData(entry).Path.Replace('\\', '/');
                    if (!path.StartsWith("/_/BehindRose/", StringComparison.Ordinal))
                        throw new Exception("Release assembly contains an unmapped debug path: " + assembly.GetName().Name);
                }
            }
        });
    }
}
