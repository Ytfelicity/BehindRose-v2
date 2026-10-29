# Clash 配置识别与一键方案

2026-10-18：取消只接受 2.5.2 的版本白名单。版本号用于诊断，是否能生成方案由标准目录、实际 YAML 结构和目标字段决定。

## 识别范围

- 需识别 Clash Verge Rev 客户端及固定的标准数据目录；`profiles` 子目录需存在。保留重解析点、文件大小和路径检查。
- `verge.yaml`、`config.yaml` 必须是可读的单文档 YAML 映射；拒绝引用、重复键、复杂键、合并键及过深结构。
- `enable_tun_mode` 是布尔值；`tun` 是映射。已有的目标开关必须是布尔值，stack 仅接受 system/gvisor/mixed，dns-hijack 接受非空标量列表。
- `tun.enable` 可缺省：官方 [2.5.7 配置定义](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.7/src-tauri/src/config/clash.rs) 与 [use_tun](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.7/src-tauri/src/enhance/tun.rs) 会在生成运行配置时补入。缺省与已有错误类型分别处理。
- 根 `ipv6` 可缺省，但已有值必须是布尔值，不能盲目覆盖字符串、列表等异常类型。

检查、预览和执行前重建共用结构约束。解析失败只显示固定文件名或字段名，不显示原始配置片段。识别通过不等同于所有版本和运行效果已经验收。

## 一键范围

网页与原生 EXE 均使用 `RepairPlanner.OneClickOptions`：`Tun | ChromeDns | EdgeDns | FirefoxDns | DisableClashIpv6 | SingMix`，掩码 111。旧 47 组合只保留底层兼容能力。

统一开启 TUN、自动路由、严格路由、网卡识别和 DNS 接管；配置浏览器跟随系统 DNS；将 Clash 根 `ipv6` 设为 `false`。当前订阅在原脚本之后叠加增量 DNS 防护，关闭相冲突的客户端 DNS 覆写。只有系统、浏览器、IPv6 和增量防护脚本全部就绪时，网页主按钮才转到检测入口。

没有单独关闭 IPv6 的界面按钮。系统卡片显示保存的 IPv6 状态，预览明确列出需改动的项目。TUN 与 IPv6 同时修改 `config.yaml` 时仅生成一个最终文件快照。根 IPv6 开关与 [Mihomo 全局定义](https://wiki.metacubex.one/config/general/#ipv6) 对应；Verge 将其作为 [应用控制字段](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.7/src-tauri/src/enhance/mod.rs) 合入运行配置。

方案不包含旧 ReplaceDns：DNS 绑定本机已有的默认代理组。原节点、策略组、分流、TUN 协议栈与原脚本行为保留，只叠加 DNS 与缺失防护规则。运行配置和原脚本仅作为只读预览依赖，不能作为备份恢复写入目标。Windows 网卡 IPv6 不改动。YAML 保存可能规范化排版和注释，备份保留原始字节。[逐项对照、恢复与验证](sing-mix配置对照.md)。

应用仍需预览确认、退出 Clash 和管理员授权；保留预览指纹、并发修改检查、受保护备份、失败回滚及恢复冲突保护。本次开发只运行内存测试和演示，没有应用本机配置。

## 复核

- C# 57 项通过：含结构识别、IPv6 组合快照、幂等、异常字段、原始字节恢复、Firefox 锁定漏检回归。
- `--local-read-check` 只读识别并生成内存预览，比较所有固定目标前后值；`--ipv6-preview` 可仅核对底层 IPv6 计划，不能执行写入。
- `tests/local-workbench.test.mjs` 使用 `--demo` 内存状态核对 API、预览、应用、恢复和 HTTP 边界。
- 原生 `--smoke-test` 强制使用演示状态；网页回归全部模拟本机接口和外部采样响应。两者都不应用真实代理配置。
