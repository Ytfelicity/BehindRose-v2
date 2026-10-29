> **开始前先看这 5 条**
>
> 1. 这份手册整合本次收集的 X 教程，并用官方文档核对操作。没有“照做就绝不封号”的配置。
> 2. 先核对 [Claude 支持地区](https://support.claude.com/en/articles/8461763-where-can-i-access-claude) 和自己的使用资格。中国大陆目前不在官方支持地区列表中；代理连通不代表取得使用资格。
> 3. 主线是 **Windows 原生 PowerShell + Clash Verge 或同类客户端 + 官方 Claude Code + 自己的 Claude 订阅**。WSL、API 中转和云厂商认证不套用本教程。
> 4. 已经能正常使用的机器，从第 9 节“每天怎么启动”开始。账号已明确封禁，直接看第 12 节申诉；不要先删配置。
> 5. 任何清理之前先备份。不要分享登录链接、授权码、API Key、.credentials.json 或备份包。下文的网络检查只用于排错，不能测出账号是否“安全”。

# 01 · 先选路线，准备好记录

第一次配置，依次完成 **02 → 03 → 04 → 05 → 06 → 07 → 08**。已有可用账号和客户端，可以跳过注册、付款和安装，只核对网络与登录状态。

| 你的情况 | 从哪里开始 | 完成标志 |
| --- | --- | --- |
| 新电脑，还没装 Claude Code | 第 02 节 | 浏览器和终端都能完成一次正常对话 |
| 网页正常，Claude Code 连不上 | 第 03、04、07 节 | 终端走到预期代理，认证方式正确 |
| 已经能用，想每天稳定启动 | 第 09 节 | 新开终端仍能带上代理设置 |
| 准备清理或重装 | 第 10 节 | 先得到可核对的本地备份 |
| 页面明确显示账号被封 | 第 12 节 | 保存证据并提交官方申诉 |

准备一个自己保存的笔记，记录下表。**不要把完整记录公开发到 X，也不要填写密码或授权码。**

| 记录项 | 自己填写 |
| --- | --- |
| 代理客户端名称、版本 | 例如 Clash Verge Rev，填写实际版本 |
| 常用节点或代理组 | 记录客户端里显示的名字 |
| HTTP / Mixed 本地端口 | 稍后在设置中读取，不预设 7897 |
| 当前模式 | 规则 / 全局；TUN 是否开启 |
| 浏览器查询到的 IPv4 | 第 03 节填写 |
| 终端查询到的 IPv4 | 第 04 节填写 |
| Claude 登录邮箱 | 只自己保存，用于核对账号 |
| 订阅渠道 | 网页 / Apple / Google Play |
| Claude Code 版本 | 第 06 节填写 |

**需要准备的东西：**自己的邮箱或 Google 账号、可用的官方订阅、已经配置好合法可用连接的代理客户端。本手册从已有节点开始，不包含购买代理、购买账号或代充的步骤。

# 02 · 找到真正的代理端口

## 2.1 打开客户端，先记录原状态

1. 从开始菜单或任务栏托盘打开 Clash Verge。
2. 点击左侧“代理”，记下当前模式和已选节点。
3. 如果正在用“自动选择 / 故障转移”组，排错时可以暂选组内一个可用节点，减少测试中途出口变化；这只是为了方便比较。
4. 已经正常工作的 TUN 配置先保留。不要为了照搬教程同时改 TUN、DNS、规则和节点。

## 2.2 开启或核对系统代理

1. 点击左侧“设置”。
2. 找到“系统代理 / System Proxy”。
3. 如果你使用系统代理方式，让开关处于开启状态。
4. 不同版本的“端口 / Ports / Mixed Port”入口可能在设置卡片或详细设置中。读取 **HTTP 或 Mixed 端口**，记入表格。
5. 只看到 SOCKS 端口时，继续查找 HTTP / Mixed 监听设置。Claude Code 的代理配置不支持 SOCKS，不能把 socks5:// 地址填进后面的命令。

**找不到端口时，用 Windows 设置核对：**

1. 按 Win + I，打开“设置”。
2. 进入“网络和 Internet → 代理”。
3. 在“手动设置代理”下查看“使用代理服务器”；Windows 11 通常需要点“设置 / 编辑”打开详细窗口。
4. 查看地址和端口。常见地址是 127.0.0.1，端口以自己窗口为准。
5. 这里只读取，不把图片里的 7897 强行写入自己的配置。如果显示的是 PAC 设置脚本，返回客户端查 HTTP / Mixed 端口。

[[figure:windows-port]]

## 2.3 规则和全局如何选择

平时原来用规则模式且正常，就继续使用。规则模式可能让不同域名走不同线路，因此“查 IP 网站走代理”不能证明 Claude 也走代理。

排错时如需减少变量，可先记录原模式，临时选“全局”并指定一个可用节点；测试结束后恢复原模式，再按第 08 节检查 Claude 的实际连接。全局模式会影响其他应用流量，不必长期保持。

[[figure:clash-proxy]]

[[figure:clash-settings]]

> **通过标准：**你已经记下实际 HTTP / Mixed 端口、当前节点和原模式，并知道系统代理是否开启。此时还没有证明 Claude 能正常使用。

[Clash Verge 快速入门](https://www.clashverge.dev/guide/quickstart.html) · [系统代理、TUN 与路由说明](https://www.clashverge.dev/guide/term.html) · [Claude Code 代理支持](https://code.claude.com/docs/en/network-config)

# 03 · 在浏览器验证，再登录自己的账号

## 3.1 先做一次浏览器检查

1. 打开日常使用的 Chrome 或 Edge。
2. 在地址栏输入 https://api.ipify.org ，按回车。
3. 页面正常时会显示一串 IPv4 地址，例如 203.0.113.10。这个例子仅展示格式，不能填入自己的配置。
4. 把实际结果记入第 01 节表格。
5. 再打开 https://claude.ai 。可以看到登录页，或已有账号的正常对话页，再继续。

如果查 IP 页也打不开，回客户端检查节点、模式和系统代理，先不要反复注册或付款。浏览器有代理扩展时，核对扩展是否另外指定线路；一次只保留自己明确知道的路由方式进行测试。

可选：为了减少账号混淆，可以在浏览器头像菜单中新建一个名为“Claude”的个人资料，专门登录自己的 Claude 账号。它方便管理 Cookie 和账号，**不代表更换了设备指纹，也不能保证防封**。

## 3.2 登录或注册

1. 在 Claude 官方页面选择 Google 登录或邮箱登录。
2. 使用自己长期能控制的邮箱。已有账号沿用原登录方式，避免误入另一个空白账号。
3. 如页面要求验证，按官方提示完成；只有实际提供的选项才适用。
4. 登录后点左下角头像或名字，确认账号邮箱。
5. 发送一句“请只回复：网页连接正常”。能收到回答，再进行订阅或终端配置。

不要把第三方发送的登录授权页面当成官网，也不要把邮件验证码发给代充或所谓售后。

## 3.3 按自己的偏好设置隐私

希望调整模型改进选项时：**头像 / 名字 → Settings → Privacy → Help Improve our AI models**，按自己的数据使用偏好开关。名称会随语言和版本变化。

Memory、位置权限和时区按实际需要设置。关闭模型改进选项，也不等于平台停止安全检测。它们不列入本手册的“防封必做步骤”。

> **通过标准：**确认自己登录的邮箱，网页能正常回复，并记录浏览器查询到的 IPv4。

[官方账号与 Pro 开通说明](https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan) · [官方隐私开关说明](https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings)

# 04 · 让 PowerShell 明确使用同一个本地代理

**系统代理开关不保证终端会跟随。**本节显式设置当前 PowerShell 的代理，让配置更容易核对。只影响这个窗口及其后续启动的进程，关闭窗口后不保留。

## 4.1 打开正确的终端

1. 按 Win，输入“PowerShell”，打开 Windows PowerShell 或 PowerShell 7。
2. 不需要以管理员身份运行。
3. 如果 Windows Terminal 打开的是命令提示符，切换到 PowerShell 标签。下面的 $env: 写法不能直接粘贴到 CMD。
4. 粘贴下面整段；出现提问时，输入第 02 节查到的数字端口，按回车。

~~~powershell
$claudeProxyPort = [int](Read-Host '输入客户端实际的 HTTP / Mixed 端口')
if ($claudeProxyPort -lt 1 -or $claudeProxyPort -gt 65535) {
    throw '端口必须在 1 到 65535 之间'
}
$claudeProxyUrl = "http://127.0.0.1:$claudeProxyPort"
Test-NetConnection -ComputerName 127.0.0.1 -Port $claudeProxyPort
~~~

输出中寻找 **TcpTestSucceeded : True**。False 表示本机该端口没有连通，通常是客户端未启动、端口填错或未监听。它和账号有没有被封无关。

## 4.2 查询终端出口

继续在同一个窗口执行：

~~~powershell
curl.exe --fail --silent --show-error --connect-timeout 10 --max-time 20 --proxy $claudeProxyUrl https://api.ipify.org
~~~

把结果和浏览器第 03 节的 IPv4 对比。

- 相同：两个测试请求的出口一致，可以继续。
- 不同：先检查浏览器扩展、客户端规则和自动切换。不要立刻判定账号有问题。
- 超时或报错：检查节点和客户端日志，先让本条命令成功。

**注意：**查 IP 请求相同，只证明这两个请求当时的出口一致。Claude 相关域名可能被单独分流，还要完成第 08 节。

## 4.3 为后续启动的 Claude Code 设置代理

~~~powershell
$env:HTTP_PROXY = $claudeProxyUrl
$env:HTTPS_PROXY = $claudeProxyUrl
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
~~~

HTTPS_PROXY 的值以 **http://** 开头是正常的：这里描述本地代理的协议，Claude 请求的目标仍可以是 HTTPS。不要自行改成 https://127.0.0.1 或 socks5://。

设置后再启动 Claude Code。已经运行的 Claude Code 不会自动读取后来修改的环境变量，先退出它，再从这个窗口重新启动。

> **通过标准：**本地端口连通，显式代理的 IP 查询成功，当前窗口已设置 HTTP_PROXY 和 HTTPS_PROXY。

[Claude Code 官方网络配置](https://code.claude.com/docs/en/network-config)

# 05 · 在官方渠道开通，并核对是否买到同一个账号

已有可用于 Claude Code 的 Pro、Max、Team 或 Enterprise 权限，可以直接核对状态后跳到第 06 节。免费网页账号不能据此获得 Claude Code 订阅权限；Console/API 是另一种计费路线，本手册不走那条路线。

## 5.1 Windows 上优先核对网页账单

1. 在 https://claude.ai 登录刚才确认的账号。
2. 点击左下角名字 → **Settings → Billing**。
3. 新订阅通常从 **Upgrade plan → Get Pro plan** 进入；套餐按钮以后续官方页面为准。
4. 选月付或年付，核对金额、币种、自动续订及税费。
5. 使用自己合法可用的付款方式，填写真实账单信息。
6. 完成付款后返回 Billing，确认套餐已生效，并保存订单和下一次续费日期。
7. 已经扣款但权益没变时，先核对登录邮箱和订单，不要连续重复购买。

套餐按工作量选择。没有可靠证据说明“先 Pro 养几天，再升 Max”能降低封禁概率，也不需要为了防封强行购买更贵的套餐。

## 5.2 如果使用手机应用商店订阅

在官方 iOS / Android Claude 应用中，先核对登录邮箱，再按 **右上角头像 / 首字母 → Upgrade to Pro** 完成应用内购买；返回同一账号的网页检查套餐是否同步。已有网页订阅时，先核对原渠道，不要同时在两个渠道重复订阅。

X 上有用户分享 Google Play 付款经历，可以了解路线；能否付款以你实际账号、地区和渠道规则为准。某个人的一张卡成功，不代表所有账号都会成功。

[[figure:payment]]

> **通过标准：**Billing 显示你需要的有效套餐；网页账号与稍后 Claude Code 授权的邮箱一致。

[网页 Pro 开通说明](https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan) · [Android 订阅说明](https://support.claude.com/en/articles/9612892-how-do-i-sign-up-for-claude-pro-on-claude-for-android) · [iOS 订阅说明](https://support.claude.com/en/articles/9266495-how-do-i-sign-up-for-claude-pro-on-the-claude-app-for-ios)

# 06 · 安装官方 Claude Code

## 6.1 已经安装的人先检查

~~~powershell
Get-Command claude -ErrorAction SilentlyContinue
claude --version
~~~

能显示版本就先别重装，直接到第 07 节。命令找不到，再进行下面的安装。

## 6.2 优先使用 WinGet

在 PowerShell 中执行：

~~~powershell
winget install --id Anthropic.ClaudeCode --exact
~~~

按安装器提示核对来源和条款。安装成功后，**关闭当前 PowerShell，再打开一个新的 PowerShell**，让新 PATH 生效。重新执行第 04 节设置代理，然后运行：

~~~powershell
claude --version
claude doctor
~~~

能看到版本号，doctor 没有阻止启动的问题即可继续。doctor 的具体输出随版本变化，不要求它和网上截图逐字一致。

## 6.3 如果提示 winget 不存在

先检查 Windows“应用安装程序 / App Installer”是否可用；也可选择官方提供的 PowerShell 原生安装方式。两种方式选一种，不在同一台电脑上混着安装。

以下命令会下载并执行 Claude 官方安装脚本。先阅读 [官方安装页](https://code.claude.com/docs/en/setup)，确认地址是 claude.ai 后，才自行执行：

~~~powershell
irm https://claude.ai/install.ps1 | iex
~~~

同样在安装后重开终端、设置代理、检查版本。不要从论坛粘贴来历不明的安装脚本，也不需要为了运行本文命令永久降低 PowerShell 执行策略。

当前官方文档把 Git for Windows 列为可选项：需要 Bash 或项目用到 Git 时安装；不要把“没装 Git”直接当作账号异常。以上步骤面向受支持的 Windows 原生环境。

**更新时也沿用原安装渠道：**WinGet 安装可以运行下面的命令；原生安装由其更新机制维护。不要为更新再叠加另一套安装方式。

~~~powershell
winget upgrade --id Anthropic.ClaudeCode --exact
~~~

> **通过标准：**新打开的终端能识别 claude，能显示版本，诊断中没有尚未处理的启动阻断问题。

[官方安装与系统要求](https://code.claude.com/docs/en/setup) · [快速开始](https://code.claude.com/docs/en/quickstart)

# 07 · 登录前，排除旧 API / 中转配置干扰

## 7.1 只查“有没有设置”，不显示密钥

以前用过 API、中转站、Bedrock、Vertex 或 Foundry 的用户，先执行下面的检查。它只显示变量名和是否存在，不打印变量值。

~~~powershell
$claudeProviderNames = @(
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY'
)
foreach ($claudeEnvName in $claudeProviderNames) {
    [pscustomobject]@{
        Name = $claudeEnvName
        IsSet = -not [string]::IsNullOrEmpty(
            [Environment]::GetEnvironmentVariable($claudeEnvName, 'Process')
        )
    }
}
~~~

全部 False 可以继续。有 True 时，先确认这是你以前主动配置的其他认证路线，还是现在仍需使用的团队环境。**本手册选择个人订阅路线。**

确认只在当前窗口切回个人订阅时，执行：

~~~powershell
foreach ($claudeEnvName in $claudeProviderNames) {
    [Environment]::SetEnvironmentVariable($claudeEnvName, $null, 'Process')
}
~~~

这不会删除用户级或系统级环境变量。下次新开窗口，旧变量可能重新出现；第 09 节启动器会检查并征求是否暂时忽略，避免悄悄改动其他工作环境。

如果仍然走向旧服务，检查自己以前写过的 Claude settings 文件和项目设置里的 env/provider 项。先备份，再按自己明确知道的配置撤回；不要上传整个配置或直接删除整个 .claude 目录。

## 7.2 发起官方登录

仍在已设置代理的同一个 PowerShell 执行：

~~~powershell
claude auth login
~~~

1. 如果出现认证方式选择，选择与你的 Claude.ai 订阅对应的方式。不要误选 API/Console 账单账户。
2. 浏览器打开授权页后，核对账号邮箱，再按页面授权。
3. 浏览器没有自动打开时，按终端提示复制登录 URL；交互式流程提供“c”复制选项时可按 c，再粘贴到自己的浏览器。
4. 如果流程要求把授权码贴回终端，只贴回自己发起登录的这个终端。
5. 终端显示登录成功后，继续检查：

~~~powershell
claude auth status --text
~~~

看到已认证状态，并确认使用预期账号/认证方式。旧版本不识别该子命令时，先按原渠道更新，再重试；也可以进入 Claude 后用 /status 查看状态。

> **通过标准：**官方授权完成，认证状态正确，个人订阅没有被旧 API Key 或中转地址覆盖。

[官方认证流程](https://code.claude.com/docs/en/authentication) · [认证命令参考](https://code.claude.com/docs/en/cli-reference)

# 08 · 在空目录做一次最小测试

先用专门的空目录验证，避免一上来就让工具读取整个工作盘。

## 8.1 创建测试目录并启动

~~~powershell
$claudeTestDir = Join-Path $env:LOCALAPPDATA 'ClaudeManual\smoke-test'
New-Item -ItemType Directory -Path $claudeTestDir -Force | Out-Null
Set-Location -LiteralPath $claudeTestDir
claude
~~~

按界面提示完成必要设置。若询问是否信任当前文件夹，先核对屏幕上的目录确实是刚创建的 smoke-test，再按自己的判断确认。

进入输入区后发送：

~~~text
只回复“终端连接正常”，不要读取、创建或修改任何文件，也不要运行命令。
~~~

收到回复后输入：

~~~text
/status
~~~

查看当前状态与认证方式；不要把完整状态截图随意公开。首轮测试会消耗套餐用量。

## 8.2 核对 Claude 实际经过的线路

1. 回 Clash Verge，打开“连接 / Connections”。
2. 保持列表可见，在浏览器刷新 Claude 页面，并在终端再发一次简单请求。
3. 在连接列表中查找 claude.ai、api.anthropic.com 等实际出现的相关主机；不同版本也可能使用其他官方主机。
4. 查看每条连接的代理链 / 节点与命中规则，核对是否符合自己的预期。
5. 看不到目标时，清空搜索筛选、检查连接记录保留时间并重试；仍看不到就暂时保留“路由未确认”，不能仅凭查 IP 成功打勾。
6. 之前临时改过全局模式的人，恢复原模式，重新测试浏览器与终端的真实连接。

> **通过标准：**网页和终端均能回复；认证账号正确；代理客户端中实际 Claude 连接的路线已核对。以上只代表当前功能正常，不代表未来不会被限制。

[官方快速开始](https://code.claude.com/docs/en/quickstart) · [Clash 路由与模式说明](https://www.clashverge.dev/guide/quickstart.html)

# 09 · 每天照这个顺序启动

## 9.1 手动启动版

1. 先启动 Clash Verge，核对节点、模式和系统代理。
2. 打开 PowerShell，执行第 04 节的端口输入与环境变量设置。
3. 切换到自己要工作的项目文件夹，再启动 Claude：

~~~powershell
$claudeProjectDir = Read-Host '粘贴项目文件夹完整路径，不需要外加引号'
if (-not (Test-Path -LiteralPath $claudeProjectDir -PathType Container)) {
    throw '文件夹不存在，请核对路径'
}
Set-Location -LiteralPath $claudeProjectDir
claude
~~~

4. 进项目之前先确认目录。重要项目使用自己的版本管理和备份；需要执行命令或改文件时，阅读 Claude 展示的内容再操作。
5. 退出时按终端提示正常退出 Claude；关闭窗口后，本窗口设置的代理变量随进程结束。

**特别容易漏：**在旧窗口设置过代理，不代表新开的 Windows Terminal、VS Code 终端也继承了那些设置。新开终端重新设置，或用下面的启动器。

## 9.2 附件脚本版：少复制几遍命令

本地 HTML 顶部可下载 3 个脚本，完整工具包也包含 scripts 文件夹。先看脚本内容，再执行。脚本提示为英文，依次输入端口和项目路径即可。

| 文件 | 做什么 | 你需要输入 |
| --- | --- | --- |
| Test-ClaudeNetwork.ps1 | 检查本地端口、代理出口和网页 HTTP 响应；只显示配置变量是否存在 | 实际 HTTP / Mixed 端口 |
| Launch-Claude.ps1 | 为启动的 Claude 设置进程代理；结束后恢复原环境和工作目录 | 端口、已有项目目录；有旧认证变量时自行确认 |
| Backup-ClaudeLocal.ps1 | 把本地 Claude 配置复制到本机备份目录 | 默认无；自定义目录见第 10 节 |

**怎么运行下载后的脚本：**

1. 在资源管理器打开保存脚本的文件夹。
2. 在地址栏输入 powershell，按回车。
3. 在打开的 PowerShell 中执行相应一行：

~~~powershell
.\Test-ClaudeNetwork.ps1
~~~

~~~powershell
.\Launch-Claude.ps1
~~~

~~~powershell
.\Backup-ClaudeLocal.ps1
~~~

启动器遇到旧 API/云厂商变量时，只列出名字，要求输入大写 YES 才会在本次运行中暂时忽略；其他输入则取消。退出 Claude 后会恢复先前的进程变量，不会写入系统设置。

如果 PowerShell 提示脚本被策略阻止，**直接回到本节手动启动版**，无需为了教程修改组织策略或系统执行策略。也可以只阅读脚本，按前面已经展开的命令逐项操作。

检查脚本遇到网页 HTTP 403，不等于检测到封禁；它只说明服务器给了该 HTTP 响应，可能还需浏览器挑战。以网页登录结果和第 12 节分类排查为准。

# 10 · 清理、重装之前，先留一份本地备份

## 10.1 使用附件备份脚本

1. 正常退出 Claude Code；如果同时开着 Claude Desktop，也先退出。
2. 在 scripts 文件夹的 PowerShell 中运行 Backup-ClaudeLocal.ps1。
3. 默认读取当前 CLAUDE_CONFIG_DIR；没有设置时读取用户目录下的 .claude。
4. 备份默认写到 **%LOCALAPPDATA%\ClaudeManual\backups** 下的独立时间戳文件夹。
5. 脚本显示 Backup saved 后，在资源管理器打开该路径，核对 config 子文件夹和 manifest.json。存在用户目录 .claude.json 时，还会复制为 user-claude.json。
6. 保留原文件，先不要清理。脚本只有复制，没有删除操作。

备份可能包含仍有效的登录凭据和会话。不要上传网盘共享链接、发给客服或提交进 Git。它不包含所有云端聊天和项目源码；项目文件另行备份，不能把本地配置备份当成账号恢复工具。

## 10.2 脚本不能运行时的手动版

1. 按 Win + R，输入 %USERPROFILE% ，回车。
2. 打开 .claude 文件夹；如果你设置过 CLAUDE_CONFIG_DIR，则打开自己设置的那个目录。
3. 按 Win + R，输入 %LOCALAPPDATA% ，新建 ClaudeManual\backups\手动日期 文件夹。
4. 把配置文件夹**复制**进去；用户目录存在 .claude.json 时也复制一份。
5. 核对备份中能看到原有文件。不要把“剪切”当成备份。

## 10.3 要恢复时怎么做

先退出 Claude，再保留当前配置的另一份副本。确认具体损坏的是哪个设置后，优先只恢复那项设置。若确需整体回退，核对 manifest 的来源目录，再将备份复制回对应路径。凭据不适合跨账号、跨机器混用，登录问题优先走第 07 节重新认证。

[官方凭据与配置位置说明](https://code.claude.com/docs/en/authentication)

# 11 · X 教程里的做法，哪些值得留下

本节覆盖本次已收集的帖子，不代表遍历了 X 上所有教程。主线保留的是便于核对和维护的操作；个人短期经历按原有证据强度呈现。

| 教程中的做法 | 本手册怎么处理 | 依据和注意点 |
| --- | --- | --- |
| 固定设备、固定常用出口 | 可用于减少排错变量 | 卡兹克用固定设备与静态住宅 IP；泊舟用 VPS。没有足够证据证明某一类 IP 必然防封 |
| 台北时区、关闭位置权限 | 按实际需求设置 | 多篇帖子提到，未证实防封效果 |
| 老 Google 账号 | 使用自己能长期管理的账号 | “买两年老号”不是官方要求，账号归属和找回更难核验 |
| 先 Pro 再 Max | 按需求控制预算 | 不能把套餐升级顺序当成风控规律 |
| Google Play / Apple 付款 | 可核对的官方渠道选项 | 某张卡成功只代表个人经历，不应复制虚构账单信息 |
| 清理旧机器的 Claude 记录 | 有明确故障、先备份再处理 | 旧凭据冲突可以排查；不能由“旧机器”推断必须重置设备 |
| CCBaga 绿色校验 | 可选辅助检查 | 项目明确不保证匿名、账号被接受或不封禁 |

[[figure:evidence]]

卡兹克原帖当时只观察了 6 天；泊舟描述的是刚完成注册、付款和使用。铁锤人的分享也出现了熟悉配置的人仍被封的反例。因而本手册不会给这些做法标“成功率”。

## 可选：确实需要 CCBaga 时

日常能用的人跳过本段。需要核对它实际能检查什么时：

1. 从 [liseami/CCBaga 官方仓库](https://github.com/liseami/CCBaga) 的 Releases 进入，按项目 Windows 文档选择与你系统架构匹配的安装包。
2. 发布页提供 SHA256SUMS 时，下载对应校验文件，对安装包运行下方命令，再逐字核对同文件名的 SHA256 值。
3. 如果系统或组织阻止安装，先核查签名、来源及组织规定；不要关闭安全防护来强行安装。
4. 打开工具先读检测项的含义。要清理时先用第 10 节备份，再核对工具预览的删除范围。
5. 遇到“清除全部浏览器数据”“直接删除”等选项，确认其不可恢复范围后再自行决定。不要为了凑齐绿色状态把正在使用的浏览器资料清空。

~~~powershell
$ccbagaInstaller = Read-Host '粘贴已下载安装包的完整路径，不需要外加引号'
Get-FileHash -LiteralPath $ccbagaInstaller -Algorithm SHA256
~~~

[[figure:ccbaga]]

原帖来源：[卡兹克](https://x.com/Khazix0918/status/2105299706549096697) · [泊舟](https://x.com/bozhou_ai/status/2109836627539558676) · [夙愿学长](https://x.com/suyuan1711/status/2101889428587421918) · [黄小木](https://x.com/ai_xiaomu/status/2064197041451102343) · [CCBaga 介绍](https://x.com/LinearUncle/status/2109477165637222693) · [丁小屁的质疑](https://x.com/ding98709897/status/2112512237353283672) · [铁锤人的反例](https://x.com/lxfater/status/2105479545071833164)

工具依据：[CCBaga Windows 文档](https://github.com/liseami/CCBaga/blob/main/docs/windows.md)。作者宣传语保留在真实截图中，不作为本手册的结论。

# 12 · 出问题时，先对照症状

| 看到的情况 | 先做什么 | 下一步 |
| --- | --- | --- |
| TcpTestSucceeded 为 False | 确认客户端已运行，重读 HTTP/Mixed 端口 | 修正后重跑第 04 节；先不动账号 |
| 浏览器能用，curl 走代理失败 | 核对端口协议、节点和客户端日志 | 确认没有把 SOCKS 端口当 HTTP |
| 浏览器和终端 IP 不同 | 检查浏览器扩展、自动切换和分流 | 按第 08 节看真实 Claude 连接 |
| curl 返回 403，浏览器正常 | 可能是浏览器挑战或访问控制 | 用实际登录与对话判断；不能据此判封号 |
| 终端找不到 claude | 重开 PowerShell，再查版本 | 检查官方安装结果与 PATH，别重复混装 |
| 显示登录成功，但走 API/扣 API 余额 | 查第 07 节变量及原有 settings | 核对认证方式，重新登录所需路线 |
| 付了款，但提示没有订阅权限 | 对照网页和终端的账号邮箱、Billing | 检查订单渠道，避免重复下单 |
| 提示额度、429 或需等待重置 | 按界面显示查看限额和恢复时间 | 限额提示本身不能当作封号证据 |
| 证书错误、TLS 验证失败 | 检查系统时间、代理证书与组织网络要求 | 按官方网络文档处理；不要用 -k 或关闭证书验证 |
| 退出 Clash 后普通网页也断网 | 可能系统代理仍指向已关闭的本地端口 | 按下方恢复 Windows 普通网络 |
| 页面明确显示账号 disabled/banned | 保留提示、邮件和订单 | 走官方申诉；不先清理本地记录 |

## 12.1 退出代理客户端后，恢复普通网络

仅在你已退出客户端、Windows 仍把流量送到旧本地端口时使用：

1. Win + I → 网络和 Internet → 代理。
2. 找到“手动设置代理 → 使用代理服务器”。
3. 关闭该开关；有“保存”按钮则保存。
4. 先验证日常普通网页是否恢复。
5. 下次要按本手册启动 Claude 时，重新启动客户端，恢复自己原有代理设置，并重做第 04 节检查。

这一步只处理残留的 Windows 代理设置，不代表 Claude 访问路线已经恢复。公司管理的代理设置先按组织要求处理。

[[figure:windows-recovery]]

[Clash Verge 官方 Windows 排错说明](https://www.clashverge.dev/faq/windows.html)

## 12.2 明确封禁时怎么提交申诉

1. 保存完整限制提示、收到的邮件、发生时间与时区、订单编号。不要公开支付卡号和登录凭据。
2. 在自己的浏览器登录原账号，打开 https://claude.ai/restricted 。
3. 按页面提供的申诉流程填写；组织显示 on hold 时，使用页面的 Request review 入口。
4. 用事实说明“何时、什么页面、显示什么、为何认为误判”，附必要订单证明。不要编造所在地或使用经历。
5. 记下提交日期和官方回复渠道，等待处理；保留现有配置与工作文件。

可直接按下面的结构填写，再删去不适用的项：

~~~text
账号邮箱：
发生时间与时区：
页面显示的完整提示：
当时正在进行的操作：
我认为需要复核的事实：
订阅渠道与订单编号（如有）：
希望确认的问题：
~~~

[[figure:official]]

[官方封禁原因与申诉说明](https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals)

# 13 · 最后核对一次，再开始日常工作

- [ ] 已核对自己的使用资格和支持地区。
- [ ] 已记下实际 HTTP/Mixed 端口，不是直接抄配图。
- [ ] 浏览器可正常对话，账号邮箱正确。
- [ ] PowerShell 显式代理查询成功。
- [ ] 已查看 Claude 的实际代理链，而不只查 IP。
- [ ] Claude Code 版本正常，认证路线是自己需要的那一种。
- [ ] 空目录中的终端测试能回复。
- [ ] 关闭并重新打开 PowerShell 后，用第 09 节方法仍能启动。
- [ ] 付款订单、续费日期和配置备份由自己保管。
- [ ] 没有把某个时区、套餐、IP 类型或绿色检测结果当成防封保证。

全部完成，表示这套环境已经能按记录重现。后续有问题，先按第 12 节对应症状排查，一次只改一项。

资料核对于 2026 年 10 月 24 日。配图均为真实网页 / 官方文档截图节选，图下注明出处；Clash 界面示例包含旧版及 macOS 截图，Windows 路径已另列。本文没有伪造 Claude 登录界面，也没有实际操作你的代理、账号或订阅。
