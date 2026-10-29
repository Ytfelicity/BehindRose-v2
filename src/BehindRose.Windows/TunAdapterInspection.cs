using System.Net.NetworkInformation;
using BehindRose.Core;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Windows;

public static class TunAdapterInspection
{
    public static Finding Read(IStateStore state)
    {
        try
        {
            var value = state.Read(Targets.Config);
            if (!value.Exists) return new("虚拟网卡运行状态", "保存的配置缺失，仍可从本机完整备份恢复。", "未找到");
            var config = RepairPlanner.Parse(value.Bytes(), "Clash 配置");
            var tun = RepairPlanner.Get(config, "tun") as YamlMappingNode;
            string? device = tun is null ? null : (RepairPlanner.Get(tun, "device") as YamlScalarNode)?.Value;
            if (!HostDiscovery.IsRunning()) return new("虚拟网卡运行状态", "Clash 当前未运行；配置中的 TUN 开关和实际网卡运行状态分别检查。", "未运行");
            var adapters = NetworkInterface.GetAllNetworkInterfaces().Where(adapter => !string.IsNullOrWhiteSpace(device)
                ? adapter.Name.Equals(device, StringComparison.OrdinalIgnoreCase)
                : adapter.Name.Contains("mihomo", StringComparison.OrdinalIgnoreCase) || adapter.Description.Contains("mihomo", StringComparison.OrdinalIgnoreCase)).ToArray();
            return adapters.Length == 1 && adapters[0].OperationalStatus == OperationalStatus.Up
                ? new("虚拟网卡运行状态", "已识别配置对应的虚拟网卡，Windows 报告为运行中；仍需检测实际流量和 DNS。", "运行中")
                : new("虚拟网卡运行状态", "尚未确认配置对应的虚拟网卡处于运行状态。应用配置并重新打开 Clash 后刷新；服务模式或权限异常需在 Clash 中处理。", "待核对");
        }
        catch (Exception error) when (error is IOException or InvalidDataException or NetworkInformationException or UnauthorizedAccessException)
        { return new("虚拟网卡运行状态", "暂时无法核对虚拟网卡，请重新打开 Clash 后刷新。", "待核对"); }
    }
}
