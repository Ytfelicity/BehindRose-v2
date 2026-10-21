# 第三方代码与素材

项目自有代码采用 [BehindRose Noncommercial License 1.0](LICENSE)，标识为 `LicenseRef-BehindRose-Noncommercial-1.0`。它仅覆盖权利人有权按该条款许可的原创部分，不重新授权第三方原始或改编代码。下列代码和素材继续按原作者许可分发；根 LICENSE 不能覆盖或替换它们的条款。中文说明见 [许可证说明](docs/许可证说明.md)。

禁止商业用途的许可不符合 [OSI 开源定义第 6 条](https://opensource.org/osd)，对外应称为“源码公开 / source-available”，不宣称为 OSI 意义的开源。不能通过给 MIT / AGPL 追加“禁止商用”来继续声称采用原版许可证；也不能限制第三方代码原本已经授予的商业使用权。

| 来源 | 用途 | 许可与本地记录 |
| --- | --- | --- |
| MyIP / IPCheck.ing | 网站连通性、WebRTC 等检测逻辑和参考源码 | MIT；`vendor/MyIP/LICENSE`、`licenses/MyIP-LICENSE.txt` |
| beUI | 工作台组件 | MIT；`licenses/beui-LICENSE.txt` |
| React Bits | 本应用集成的动效组件；公开来源与哈希记录，不公开重复注册表源码快照 | 自定义 MIT + Commons Clause；`licenses/react-bits-LICENSE.md`；原始及改编部分不适用本项目非商业许可，不作为独立组件包分发 |
| GSAP | 当前 UI 动效工具 | 标准专用许可；`licenses/GSAP-NOTICE.txt` 记录安装版本版权、官方条款链接与日期，不标为 MIT |
| React / ReactDOM / Scheduler、Motion、Floating UI、clsx、tailwind-merge、lucide-react | 实际捆绑的 UI 运行依赖 | 同安装版本的完整 MIT / ISC 文本保存在 `licenses/frontend/`，对应版本见 `manifest.json` |
| Figtree / EB Garamond | 随包字体 | SIL OFL；`src/BehindRose.Desktop/Assets/diagnostics/fonts/*-OFL.txt` |
| flag-icons / Lobe icons | 国旗、服务图标 | 对应 `licenses/flag-icons-LICENSE.txt`、`licenses/lobe-icons-LICENSE.txt` 与图标目录许可证 |
| DB-IP | 本地国家信息数据 | 随包目录与页面署名保留；使用数据版本的 CC-BY 条款 |
| .NET、WebView2、YamlDotNet | Windows 运行时与解析器 | `licenses/` 中对应许可证及第三方说明 |
| ASP.NET Core 10.0.12 | EXE 内置的回环工作台服务；随自包含包分发 | MIT 及第三方说明；`licenses/aspnetcore-LICENSE.txt`、`licenses/aspnetcore-THIRD-PARTY-NOTICES.txt` |
| Velopack 1.2.161 | 程序更新、安装与重启；项目本地 vpk 工具版本一致 | MIT；`licenses/Velopack-LICENSE.txt`；来源版本提交 `92d6a1c91716729d449034df5c50307dcce39493` |

React Bits 上游允许将组件作为应用、网站或产品的一部分分发，同时限制分发组件本身（包括单独、成包或移植版本）。本项目将其作为网络工具应用的 UI 集成，保留原条款，不作为独立组件产品发布。它不是纯 MIT，也不属于 OSI 意义的开源许可证，不能重新标记为项目非商业许可、MIT 或 AGPL。见 [上游许可证](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md) 和 [Commons Clause 说明](https://commonsclause.com/)。

GSAP 3.15.0 用于普通应用界面动效。本项目没有提供条款所禁止的、与 Webflow 竞争的可视化动画构建工具。保留原版权及 [GSAP 标准许可](https://gsap.com/community/standard-license/) 引用。上述说明记录当前应用用途，不为下游重新组合或变更用途预先授予许可。两项受限依赖的用途、范围及许可摘要哈希记录在 `licenses/scope.json`。

NetQuality / IPQuality 的 AGPL 源码、派生脚本、VPS 运行器、桥接接口、报告组件、专用测试与随包复制规则已于 2026-10-18 移出公开源码和构建路径。本地恢复副本位于被忽略的 `private/`，不是公开仓库或发布包的一部分；没有给原 AGPL 代码改许可。当前独立编写的代理测量使用公开节点端点事实，来源见 [代理测量记录](docs/代理网络质量.md)，不复制或执行上述脚本；当前 IPPure、IPLeak 和 MyIP 检测模块继续保留。

IPPure、IPLeak、ipify、各网站与 STUN 端点是运行时第三方服务。引用其公开接口不代表这些服务由本项目提供，也不代表本项目获得了其商标或服务源码的授权。检测范围与来源见使用说明和检测页。
