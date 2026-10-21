# 身后红玫瑰 · 网络助手 v2

面向普通 Windows 用户的本地网络体检、Clash 配置修复、联网采样和备份恢复工具。基于 v1.9 的配置与检测行为重构，原 v1.9 保持独立。

## 当前开发方式

目前处于开发预览阶段。支持程序更新的预览包在 [GitHub Releases](https://github.com/Ytfelicity/BehindRose-v2/releases) 下载；日常开发从源码运行，保存时不生成发布包。

- 双击 **启动开发模式.cmd**：打开完整浏览器工作台，含体检、网络检测、修复预览、备份恢复和设置。
- **启动检测页面.cmd** 也进入同一工作台。HTML / CSS / JS 保存后自动刷新。
- 原桌面入口保留：`pwsh -File scripts/dev.ps1 -Mode Desktop`；内存演示使用 `-Demo`。
- 本地地址：<http://127.0.0.1:4317/>（需要开发服务运行）。

前端沿用现有深色工作台，将网络检测与本机配置分开。“网络检测”同一页只保留浏览器网络、网站连通性、IP 质量三个区块；顶部编号链接只滚动到对应分区，不切换或卸载内容。各区保留检测按钮与结果，运行中的分区链接显示“进行中”。浏览器检测项抽屉只控制 IP、DNS 与 WebRTC，其余分区分别启动。VPS 体检与代理三网测速已退出当前界面，不再加载或轮询相关检测模块；旧入口显示网络检测页。组件位置与构建命令见 [前端说明](frontend/README.md)。

| 想检查什么 | 所在分区 / 入口 | 开始前 |
| --- | --- | --- |
| 浏览器出口、DNS 与 WebRTC | 浏览器网络 | 无需连接信息，按需选择三个检测项目 |
| 网站响应与 HTTPS 耗时 | 网站连通性 | 选择网站分组和采样方式 |
| IP 归属、风险系数和类型 | IP 质量 | 使用已有本机 HTTP 代理，也可选择本机默认网络；无需 Docker |

检测页说明对象、预计耗时和前提；未检测时显示下一步，不铺开空白结果表。侧栏“一键配置”统一展示当前状态和自动生成的系统/浏览器 DNS 方案，先预览再确认，浏览检测页不会应用配置。

详情见 [开发模式](docs/开发模式.md)。DNS 探针参数冲突已在源码修复并通过开发页实测，见 [排查记录](docs/2026-09-22-开发模式与DNS修复.md)；旧发布包保持原样。

网络连通性使用固定版本 IPCheck.ing / MyIP 的探测地址、原始 GET 检测函数及采样参数。默认每站 10 次取最低成功值；首轮全部结束后，每 500 ms 启动后续轮次，各站错峰 50 ms，慢请求可重叠。单次 3.6 秒超时，保留 200 ms 快慢分界，不用整组 5/8 秒预算截断；也可选择原版单次，单站重测始终一次。仍使用当前浏览器网络设置，不修改本机代理。逐项核对与保留的适配边界见 [检测源码对齐记录](docs/2026-10-17-检测源码对齐.md)；旧的 3 次/5 秒策略已被本次原版对齐替代。

AI 十五站和自定义网站仍可选择。与 IPCheck.ing 对照时需使用同一浏览器、相同分组与采样模式；既往线上代码及 Chrome 网络记录见 [逐项研究记录](docs/2026-10-16-IPCheck逐项对照.md)。


DNS 解析来源使用 IPLeak.net 的真实服务，当前浏览器以同一会话顺序请求新域名，最多 300 次；实时显示解析器与官网累积命中次数，支持停止并保留部分结果。归属使用 IPLeak 公开 JSON 接口，本机后端不转发采样、不修改代理或 DNS 设置，见 [IPLeak DNS 接入](docs/IPLeak-DNS接入.md)。WebRTC 保留同版本 MyIP 的四源配置、五秒采样窗口与首个映射候选，见 [MyIP 检测接入](docs/MyIP检测接入.md)。核心采样结束后再测网站；停止后不再启动网站检测。

## IP 质量体检

已改用 IPPure 官方公开接口 `https://my.ippure.com/v1/info`。本机服务通过独立的普通权限 WebView2 正常打开固定接口，读取原始 JSON；默认使用已识别的本机 HTTP 代理，失败不回退直连，也可明确选择本机默认网络。此方式处理官网不允许跨域读取的限制，没有关闭浏览器安全检查或复用用户浏览器配置。不再依赖 Docker 或运行 IPQuality；旧引擎的多库评分、解锁、SMTP 和黑名单栏目已移除。风险分值与住宅 / 机房、原生 / 广播标记直接采用 IPPure 返回值，分档与官网首页一致，IPv6 不计算风险系数。支持停止、刷新恢复和 JSON 报告；仅匹配同一出口的结果会补充浏览器归属。接口、适配与验证边界见 [IPPure 接入](docs/IPPure接入.md)。旧 IPQuality 与 NetQuality 源码、派生适配器、VPS 接口和打包引用均已移出公开源码及构建路径。

选择“本机 HTTP 代理”时，端口从已启用的 Windows 系统代理、HTTP 代理环境变量和 Clash HTTP / 混合端口配置中识别，并与本机 TCP 监听表核对。相同端口合并来源；单一候选自动填入，多个候选由用户选择，未找到时保留手动输入与重新识别。SOCKS 专用端口不作为 HTTP 候选，PAC 脚本不执行，不扫描端口或发送连接探针，不修改客户端配置。任务、报告与所选端口保留在服务内存，刷新恢复不重新查询。IPv4 / IPv6 由实际返回的出口决定，旧的状态请求不能覆盖新的开始或停止操作。指定端口只应用于这次查询的独立浏览器进程，不写系统代理或已有浏览器配置。

邀请码激活已从当前运行流程移除；左侧入口为“赞赏作者”。


## 发布预览版

首次使用请下载 Release 的完整便携包或安装包。运行便携包中 current/BehindRose.exe 或根目录的程序入口，保留全部文件。不需要手动安装 .NET；完整工作台依赖 WebView2 Runtime。运行 `BehindRose.exe --demo` 可体验不改真实配置的内存演示；浏览器网络采样仍须手动开始。

v2 当前是预览版。Clash 配置按标准目录、YAML 结构和目标字段识别，版本号仅作参考；检查、预览与执行共用结构校验，无法识别时说明具体原因。工作台的“一键配置”统一处理系统与受支持浏览器的 DNS 策略，保留现有上游 DNS 服务；网页与原生 EXE 均使用同一份一键方案，包含关闭 Clash IPv6。结构识别通过不表示运行效果已经验收，见 [Clash 配置结构校验](docs/Clash配置结构校验.md)。

## 工程

- `BehindRose.Core`：修复计划、快照模型、状态与事务回滚；不访问真实注册表。
- `BehindRose.Windows`：固定目标文件与注册表适配、受保护备份、版本识别、提权工作进程。
- `BehindRose.Desktop`：WebView2 承载与开发模式相同的完整工作台，内置仅回环地址的普通权限接口，无需 Node.js；负责窗口和更新生命周期。
- `BehindRose.DevHost`：浏览器开发模式的本机服务，通过标准输入输出接收固定命令，复用同一配置核心与提权进程。
- `BehindRose.Tests`：故障注入、幂等、字段保留、恢复冲突及真实文件原子写入测试。

提权进程只接受用户 SID、会话号、操作编号、选项位与计划指纹，不接受文件路径、注册表路径、脚本或任意可执行命令。实际计划在提权进程重新生成并比对指纹。桌面 WebView2 检测消息只更新采样状态；浏览器工作台通过仅绑定回环地址的本地接口操作配置，校验 Host、Origin 和页面会话令牌。

## 构建

需要 .NET 10 SDK、Windows x64。首次还原依赖需要访问 NuGet，随后使用锁文件进行可重复还原。`.packages` 是可选本地缓存，不应提交。

网页工作台还需 Node.js。修改前端时先在 `frontend` 执行 `npm ci`、`npm run check`、`npm run build`；浏览器回归需先安装 Playwright Chromium（`npx playwright install chromium`）并运行开发服务。本次验证使用 Node.js 24 与 .NET 10。

```powershell
dotnet restore BehindRose.slnx
dotnet build BehindRose.slnx -c Release --no-restore
dotnet run --project tests/BehindRose.Tests -c Release --no-build
node tests/diagnostics.test.cjs
node tests/country-lookup.test.cjs
node tests/public-source.test.mjs
node tests/source-checkout.test.mjs
node tests/local-workbench.test.mjs
node tests/ipquality-lifecycle.test.mjs
./scripts/build.ps1
```

可以通过 `-Dotnet` 指定本地 SDK 的绝对路径。执行框架依赖的测试和 GUI 时，需让 `DOTNET_ROOT` 指向该 SDK 所在目录，或已安装对应桌面运行时。

宿主测试默认使用 Release 构建。SDK 优先取 `BEHINDROSE_TEST_DOTNET`，其次为可选的旁置本地 SDK，最后为 PATH 中的 `dotnet`；不要求复制作者的 tools 目录。可通过 `BEHINDROSE_TEST_CONFIGURATION=Debug` 或 `BEHINDROSE_TEST_HOST` 指定已构建宿主。`source-checkout` 测试在隔离临时仓库中验证 Windows 自动换行检出、源码与索引检查、固定来源哈希和生成器。

原生 GUI 验证：运行开发构建 `BehindRose.exe --smoke-test`。只使用内存状态进行修复与恢复，并加载本地 WebView2 页面验证资源；不会修改真实配置或启动网络采样。输出到当前目录的 `ui-smoke`。

可选安装包脚本为 `scripts/installer.iss`。需要已安装的 Inno Setup；本次便携包交付不依赖打包器。可以向构建脚本传入 `-Iscc` 生成安装包。安装包脚本需在实际打包环境单独验收。

仅在用户明确要求发布时，才使用 `scripts/build.ps1 -Publish`。日常修改使用开发入口。

## 许可证与源码公开

项目继续禁止商业用途。程序已接入启动检查、确认后下载和更新的流程，使用 GitHub Releases 与 Velopack；更新源绑定 [Ytfelicity/BehindRose-v2](https://github.com/Ytfelicity/BehindRose-v2)。使用支持更新的安装包或便携包后，后续新版会在启动时提示；源码与旧版普通包不会自动获得该能力。打包、发版和验收步骤见 [程序更新](docs/程序更新.md)。

项目自有代码采用 [BehindRose Noncommercial License 1.0](LICENSE)：允许非商业使用、修改和免费分发，禁止商业使用、转售、商业产品集成、付费服务及支撑营利业务。机构身份不自动豁免商业用途。中文解释见 [许可证说明](docs/许可证说明.md)，英文 LICENSE 为准。

这是“源码公开 / source-available”项目，不以 OSI 意义的开源软件宣传。第三方原始及改编部分继续适用各自许可，不能用项目非商业条款覆盖它们。React Bits 作为本应用 UI 的一部分集成，GSAP 用于普通界面动效，不作为独立组件包或可视化动画编辑器发布；边界及原许可见 [第三方清单](THIRD_PARTY_NOTICES.md)。公开检查记录见 [发布前检查](docs/开源前检查.md)。

仅以本工程目录作为仓库根目录，不上传上级工具目录。`.gitignore` 排除本机私有资料、报告、截图、缓存、旧认证部署资料，以及常见凭据、密钥、数据库、备份和压缩包。使用 Git 提交源码，不要将整个工作目录拖入 GitHub 上传。

每次克隆后执行 `node scripts/install-git-hooks.mjs` 启用本机提交前检查；首次从源码目录建仓时，先在工程根目录执行 `git init`。安装器只设置当前仓库的 `core.hooksPath`，遇到已有其他钩子配置会停止并说明。检查依赖 Node.js 和 Git，普通工作区检查另需 ripgrep。

```powershell
node scripts/install-git-hooks.mjs
node scripts/check-public-source.mjs
# 按需暂存源码后，核对实际将提交的内容
node scripts/check-public-source.mjs --staged
```

默认检查覆盖未忽略的工作区文件和整个 Git 索引；`--staged` 与提交钩子直接检查整个索引中的内容、私有路径、禁用模块、许可记录及常见凭证格式，强制暂存的忽略文件也会被拦截。索引中的敏感值不会被工作区的干净副本掩盖，检查结果不打印凭证原文。退出码 0 表示技术检查通过，1 表示发现禁止公开的路径、凭证格式或禁用源码，2 表示许可文件或边界记录不完整；工具或索引读取失败同样阻止提交。

测试中的固定 IP 使用公共 DNS 服务地址，国家标签以固定版本离线数据库为准；真实网络出口、订阅和实测报告保存在被忽略的本地目录。钩子需要每个克隆单独安装，也能被人为跳过；它不扫描提交历史或远程仓库，模式检查不能证明所有秘密均不存在，也不代替法律判断。检查不会应用代理或系统配置。

## 行为与限制

详见 [使用说明](docs/使用说明.md) 和 [验证范围](docs/验证范围.md)。

- 修改 Clash 文件前要求用户从托盘退出客户端，不强杀任何进程。
- 一键方案统一处理 TUN、路由、DNS 接管、浏览器 DNS 和关闭 Clash IPv6（47）；保留上游 DNS、节点、订阅及 Windows 网卡 IPv6。应用前需预览确认并备份，支持恢复。
- 浏览器无需立即关闭，策略在重启后复检。
- 只备份及恢复本次触及的目标；后续变动有冲突时停止恢复。
- YAML 引用、合并键、复杂键和重定向路径拒绝自动修改。
- 备份存于 ProgramData 下受管理员保护的独立 v2 目录；恢复前保存当前状态。
- 当前版本不迁移旧备份、不内置订阅、不自动更新客户端、不限制 WebRTC UDP。
- 不提供“绝无泄漏”的全局结论；应用内采样不代表外部浏览器。

## 来源

复用本地 v1.9 的检测页面和地址校验逻辑，增加主题同步及有限状态桥。第三方许可见 `licenses`。配置核心依据原 `SafeConfiguration.cs` 的 YAML、备份和回滚设计拆分，并加入选项隔离、计划指纹、恢复冲突检查与故障测试。
