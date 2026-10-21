# 工作台前端

## Dashboard 4 布局改造

当前网络检测页分为浏览器网络、网站连通性、IP 质量三个区块。浏览器网络包含 IPv4、IPv6、DNS 和 WebRTC 概览及来源对照卡；顶部编号链接只做页内定位。检测选项位于默认关闭的抽屉，DNS／WebRTC 也可独立检测。代理三网测速和 VPS 体检已移出当前界面，相关组件不再加载。

项目原创部分适用根目录 [非商业许可证](../LICENSE)，禁止商业用途，中文解释见 [许可证说明](../docs/许可证说明.md)。第三方原始及改编组件继续适用各自许可，见 [第三方清单](../THIRD_PARTY_NOTICES.md)。闲置 NetQuality / IPQuality 的 AGPL 源码、派生适配器、VPS 桥接和打包规则已移出公开源码与构建路径；IP 质量仍使用 IPPure。

这是参照 React Bits Pro Dashboard 4 的公开预览、使用本项目既有 React/beUI 独立编写的界面。官方源码需要 Pro 授权，本次没有提取或复用该付费组件。用户指定的 website-rebuild 技能取证、范围边界和有意差异见 [改造记录](../docs/dashboard4-rebuild/REBUILD_PLAN.md)。没有新增依赖、远程字体、示例历史图或虚构指标。

样式分别位于 `dashboard4-theme.css`、`dashboard4-workbench.css`、`dashboard4-network.css`。本机服务使用其它端口时，浏览器回归通过 `BEHINDROSE_TEST_URL` 指定地址。

网站品牌图标、国旗、字体与界面图片随程序本地分发，打开页面不请求第三方图标服务。服务 SVG 的来源、版本与原始字节哈希记录在 `Assets/diagnostics/service-icons/manifest.json`；YouTube、微信使用 Font Awesome Free 6.7.2，其余图形来自既有 Lobe icons。字符图标和自定义网站的通用图标直接由本地组件渲染。发布资源使用显式逻辑路径，保留目录连字符，避免 SDK 命名空间改写导致 EXE 内的图标与国家数据库无法读取。

网站检测不会因浏览器网络正在采样而一直禁用。用户点击“检测本组”时，先通过浏览器采样生命周期接口取消并等待当前采样结束，保留已取得的数据，再启动网站请求；界面事先显示说明。网站批次自身仍阻止重复启动，组合检测继续先完成浏览器采样再测网站。开发服务可加 `--no-watch` 验证已生成的前端资源，避免测试期间重新生成开发构建。

## 一键配置入口

侧栏只保留“网络检测 / 一键配置 / 恢复记录”，帮助与关于位于底部。原配置概览和 DNS 配置统一到 `#overview`；旧 `#repair` 链接自动转到同一页面，不再展示范围勾选或另一套配置页。

点击“一键配置”才请求内置方案（`Tun | ChromeDns | EdgeDns | FirefoxDns | DisableClashIpv6`，掩码 47），统一检查系统与三款受支持浏览器的 DNS 策略，保留当前上游 DNS 服务。方案直接复用原计划与备份/恢复机制：预览具体改动，确认后才申请管理员权限并执行。只打开页面、查看预览和本次浏览器回归都不会写本机配置；已配置时按钮前往检测。宿主不兼容或存在不可修改/管理员管理的策略时显示具体状态，阻止静默应用部分方案。宿主按标准目录、YAML 结构和目标字段校验，版本号仅作参考；检查、预览和执行共用结构约束。

## IP 质量来源（2026-10-18）

现有 IP 质量分区已改用 IPPure 官方公开接口。`src/ippure.ts` 负责字段校验和官网风险分档；`quality-api.ts` 复用本机受限桥，由 `IpPureRunner` 与独立 WebView2 正常打开固定接口、读取 JSON，避免本地页面跨域读取被官网阻止。只展示接口实际提供的归属、风险和类型，不再启动 Docker 或显示旧引擎的服务、邮件结果。默认使用已有本机 HTTP 代理，也可选择本机默认网络。单次查询、20 秒上限，停止和迟到结果隔离，IPv6 风险不伪造为零。详见 [IPPure 接入](../docs/IPPure接入.md)。`npm run test:ippure` 与 `npm run test:quality` 使用模拟数据，不修改系统代理。

## 网络连通性来源

直接复用 IPCheck.ing / MyIP 固定版本的 `checkConnectivityHandler`，由构建辅助脚本从原始 Vue 文件逐字提取；内置探测地址从同版本的目标数据生成。整组默认 10 轮最低成功值，首轮全部结束后每 500 ms 启动后续轮次，每站错峰 50 ms，慢请求可以重叠，等待全部计划请求结束；单站重测为单次。移除了本地 3 次采样、同站串行和整组 5/8 秒截断策略，保留上游 3.6 秒请求超时、200 ms 分界及未经抬高的实测数值。生成器校验固定源码 SHA-256 并提取轮数、间隔和错峰参数；适配层补充取消传播、无凭据请求和每轮报告。原始源码、MIT 许可与来源记录见 `../vendor/MyIP/`；逐项核对见 [检测源码对齐](../docs/2026-10-17-检测源码对齐.md)。

## DNS 与 WebRTC 来源

`myip-diagnostics.ts` 将 `ipleak-dns.ts` 和固定版本 MyIP WebRTC 模块接到既有检测引擎，打入现有 `network-ui.js`，桌面资源和开发网页共用。DNS 直接使用 IPLeak.net 的浏览器跨域 GET：同一 40 位会话加递增域名序号，顺序请求最多 300 次；第 100 次起下一次采样间隔为 1 秒，之前为 1 毫秒。每次响应包含累积解析器与命中次数，卡片按首次出现顺序保留，命中次数直接更新而不相加。归属来自 IPLeak 公开 JSON API，最多 4 个并行查询，每个 IP 每次运行仅查询一次；失败显示归属未取得，不移除已采到的地址。

所有采样和归属请求均由当前浏览器执行，省略 Cookie、认证与 Referrer；无本机 DNS RPC，也不修改系统代理、浏览器或 DNS 设置。没有自动采样。停止会取消浏览器请求和采样间隔，保留部分结果，迟到响应不能污染旧结果或下一次运行。应用对归属接口增加 10 秒超时和响应大小限制，DNS 采样本身沿用官网串行请求，仍可随时停止。

`npm run test:ipleak-dns` 用离线模拟验证 300 次协议与时间间隔、累积命中次数、归属、失败、停止和迟到响应。`npm test` 验证真实浏览器跨域请求路径（服务返回使用模拟）、卡片、复制报告、独立采样、八项摘要和手机布局。测试不会写入本机代理配置。WebRTC 来源记录仍由 `npm run test:myip-diagnostics` 校验。

## React Bits UI 升级

已接入 React Bits 的 DotGrid、BlurText、GradientText、SpotlightCard、AnimatedContent、CountUp、ClickSpark、ShinyText 和 StarBorder。官方 TS-CSS 来源与 SHA-256 保存在 `reactbits-provenance.json`，原始注册表快照仅留本地并从公开清单排除，14 个原始组件和样式文件保存在 `src/components/reactbits/`，未修改源码。集成层为 `src/reactbits-integration.tsx`，颜色和布局适配为 `src/reactbits-ui.css`；减少动态效果时使用静态替代，后台页面停止点阵绘制。

网络检测、概览、防护设置、恢复记录、偏好设置、设备认证弹窗和移动版的真实截图，以及九个官方组件预览截图，集中在 `../docs/ui-reactbits-2026-10-02/`。`UI升级对照.html` 内嵌所有图片，可离线打开；`capture-manifest.json` 记录拍摄 URL、时间、数据来源及源码 SHA-256。截图读取真实本机接口，没有替换 API 数据，没有执行外网检测、激活、修复或恢复写入。

```powershell
# 开发服务已运行时，重新拍摄本地界面和官方组件
node scripts/capture-upgrade.mjs
# 官方图片已经保存时，只刷新本地截图与校验
node scripts/capture-upgrade.mjs --reuse-official
node scripts/build-upgrade-report.mjs
node scripts/verify-upgrade-report.mjs
# 可选：通过本机 4318 端口查看对照 HTML
node scripts/report-server.mjs
```

React Bits 许可是 MIT + Commons Clause，见 `../licenses/react-bits-LICENSE.md`。组件用途、真实界面与官网预览逐项对应，未把项目自己的 DOM 桥接、布局和检测逻辑描述为组件库提供的能力。

## 基础控件

使用统一功能侧栏、顶部标签与主内容、右侧连接面板、底部状态条。左侧快捷图标栏已合入功能侧栏，避免重复导航；主题切换与设备认证统一置于侧栏底部。默认进入网络检测。浅色为首次默认主题，已有主题偏好继续保留；窄屏的功能侧栏使用 beUI 的移动面板，连接面板通过右上角按钮打开。

优先复用 [beUI Motion](https://beui.dev/components/motion) 的实际源码，而非自行模仿组件动效。组件和关联工具文件保存在 `src/components/motion`、`src/lib`，原始注册表响应在 `registry`，下载日期为 2026-10-02。第三方 MIT 许可见 `../licenses/beui-LICENSE.txt`。现有检测、配置、认证逻辑继续独立维护。

| beUI 组件 | 使用位置 |
| --- | --- |
| Animated Sidebar | 功能导航、收起侧栏、移动菜单及焦点管理 |
| Tabs | 五个工作台标签，使用 underline 与弹簧指示器 |
| Button | 侧栏底部操作、检测开始/停止/复制/清空、右侧操作、设备认证 |
| Switch | 公网 IP、DNS、WebRTC、地区查询选项 |
| Tooltip | 侧栏主题按钮的悬停与键盘焦点说明 |
| Animated Badge | 右侧采样状态 |
| Shared Layout Background | Sidebar 关联的选中与悬停背景 |

仅业务专属的信息卡、解析路径示意和布局使用项目 CSS。没有引入远程脚本、字体或运行时组件 CDN。

原始组件仅作两项交互适配：SidebarMenuButton 增加组合标签收起后的可访问名称；TabsList 增加左右方向键、Home、End 导航。原始快照保留在 `registry`，可以核对复用来源与局部修改。

控件保留 beUI 默认尺寸、圆角和动效：Switch 为 48×28，主按钮高 40，辅助按钮高 32，状态徽标使用原始 `sm` 规格。Tailwind 工具类直接作用于控件；只对 beUI 控件做浏览器基础样式重置，避免旧页面 CSS 覆盖组件。业务说明文字至少 12px，保留统一语义色；解析路径默认收起，出口数据集中在主区卡片中展示。

```powershell
cd frontend
npm ci
npm run build
npm run check
# 先启动项目的开发服务，再运行浏览器回归
npm test
```

`build.mjs` 使用 esbuild 打包 React / Motion，Tailwind 生成 beUI 的语义色工具类，保留旧检测与配置页面的样式边界。生成资源随源码保存，直接双击项目的“启动开发模式.cmd”即可使用；安装前端依赖后，开发服务自动监听 TSX 和 Tailwind 源码。只需修改业务 CSS 时不需要重新构建。

`src/main.tsx` 向四个既定容器挂载 React UI。`src/network-ui.tsx` 在检测脚本绑定事件前同步渲染 beUI 按钮，保留检测控制 ID。右侧开关与检测页真实复选框同步，采样期间或配置操作期间禁用。状态来自既有页面的实际采样结果，不发起额外检测，也不把无数据解释成通过。

关闭 Clash IPv6 已纳入同一个一键方案（47），没有独立按钮。系统卡片仅显示保存的 IPv6 状态；需系统接管、浏览器 DNS 与 IPv6 关闭全部就绪后，主按钮才切换为检测入口。无法识别 IPv6 字段时阻止预览；不替换上游 DNS、不关闭 Windows 网卡 IPv6。

浏览器测试使用模拟本机接口和第三方采样响应，验证初始不自动采样、开始/完成/清空/停止、结果归组、失败提示、选项同步、配置预览确认、一键 IPv6 关闭及已关闭/异常/未设置状态、认证入口、主题、侧栏及移动布局。测试不执行实际修复或激活，也不访问公网 STUN。测试默认使用 Playwright Chromium，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定本机 Chromium。
