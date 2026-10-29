// Article-derived static content. No imports, side effects, network requests or command execution.
export interface ClaudeHandbookCommand {
  label: string; language: string; code: string; network: boolean; execution: 'display-only';
}
export interface ClaudeHandbookLink { label: string; url: string; }
export interface ClaudeHandbookSection {
  id: string; title: string; summary: string; steps: string[]; checkpoints: string[];
  commands: ClaudeHandbookCommand[]; links: ClaudeHandbookLink[]; figures: string[];
  kind: 'manual' | 'local' | 'network' | 'optional';
  sourceArticleSections: string[]; sourceMarkdown: string;
}
export interface ClaudeHandbookOptionalItem {
  id: string; title: string; sourceSections: string[]; articleSections: string[];
  required: false; evidence: 'unverified' | 'preference' | 'convenience';
  evidenceNote: string; steps: string[]; links: ClaudeHandbookLink[];
}
export interface ClaudeHandbookFigure { id: string; file: string; caption: string; note: string; source: string; }
export interface ClaudeHandbookSource {
  title: string; date: string; manualPath: string; articlePath: string; sections: number;
  scope: string; executionPolicy: string; sourceOpeningMarkdown: string;
}

export const claudeHandbookSource: ClaudeHandbookSource = {
  "title": "Claude Windows 详细操作手册",
  "date": "2026-10-24",
  "manualPath": "docs/claude-handbook/handbook.md",
  "articlePath": "docs/claude-handbook/experience-summary.json",
  "sections": 13,
  "scope": "Windows 原生 PowerShell + Clash Verge 或同类客户端 + 官方 Claude Code + 自己的 Claude 订阅",
  "executionPolicy": "指南中的命令只显示或复制，不会自动执行。网络、登录、付款、安装与外部页面均须由使用者另行主动操作；开发期间不测试真实网络、不修改当前配置。",
  "sourceOpeningMarkdown": "> **开始前先看这 5 条**\n>\n> 1. 这份手册整合本次收集的 X 教程，并用官方文档核对操作。没有“照做就绝不封号”的配置。\n> 2. 先核对 [Claude 支持地区](https://support.claude.com/en/articles/8461763-where-can-i-access-claude) 和自己的使用资格。中国大陆目前不在官方支持地区列表中；代理连通不代表取得使用资格。\n> 3. 主线是 **Windows 原生 PowerShell + Clash Verge 或同类客户端 + 官方 Claude Code + 自己的 Claude 订阅**。WSL、API 中转和云厂商认证不套用本教程。\n> 4. 已经能正常使用的机器，从第 9 节“每天怎么启动”开始。账号已明确封禁，直接看第 12 节申诉；不要先删配置。\n> 5. 任何清理之前先备份。不要分享登录链接、授权码、API Key、.credentials.json 或备份包。下文的网络检查只用于排错，不能测出账号是否“安全”。"
};

export const claudeHandbookOpening: string[] = [
  "这份手册整合本次收集的 X 教程，并用官方文档核对操作。没有“照做就绝不封号”的配置。",
  "先核对 [Claude 支持地区](https://support.claude.com/en/articles/8461763-where-can-i-access-claude) 和自己的使用资格。中国大陆目前不在官方支持地区列表中；代理连通不代表取得使用资格。",
  "主线是 **Windows 原生 PowerShell + Clash Verge 或同类客户端 + 官方 Claude Code + 自己的 Claude 订阅**。WSL、API 中转和云厂商认证不套用本教程。",
  "已经能正常使用的机器，从第 9 节“每天怎么启动”开始。账号已明确封禁，直接看第 12 节申诉；不要先删配置。",
  "任何清理之前先备份。不要分享登录链接、授权码、API Key、.credentials.json 或备份包。下文的网络检查只用于排错，不能测出账号是否“安全”。"
];

export const claudeHandbookSections: ClaudeHandbookSection[] = [
  {
    "id": "01",
    "title": "先选路线，准备好记录",
    "summary": "按当前状态选择入口，先记录端口、账号、付款渠道与安装版本，已有可用环境跳过重置。",
    "kind": "manual",
    "steps": [
      "新电脑按 02 → 03 → 04 → 05 → 06 → 07 → 08 完成；已有账号、订阅或客户端时跳过相应注册、付款和安装。",
      "网页正常而终端异常，从 03、04、07 节核对；已经能正常工作，从 09 节日常启动开始。",
      "准备清理或重装先到 10 节备份；明确显示封禁，直接到 12 节保存证据与申诉。",
      "自己记录客户端名称版本、常用节点或代理组、实际 HTTP / Mixed 端口、规则或全局模式和 TUN 状态。",
      "继续记录浏览器与终端 IPv4、自己的登录邮箱、订阅渠道、Claude Code 版本；记录只由自己保管，不填密码、授权码。",
      "准备自己的邮箱或 Google 账号、可用官方订阅和已有合法可用连接的代理客户端；文章不包含买号、买代理或代充。"
    ],
    "checkpoints": [
      "已选好自己的起始章节，正常工作环境不为照教程重置。",
      "已准备记录表，并核对使用资格。"
    ],
    "commands": [],
    "links": [],
    "figures": [],
    "sourceArticleSections": [
      "official",
      "account",
      "checklist"
    ],
    "sourceMarkdown": "# 01 · 先选路线，准备好记录\n\n第一次配置，依次完成 **02 → 03 → 04 → 05 → 06 → 07 → 08**。已有可用账号和客户端，可以跳过注册、付款和安装，只核对网络与登录状态。\n\n| 你的情况 | 从哪里开始 | 完成标志 |\n| --- | --- | --- |\n| 新电脑，还没装 Claude Code | 第 02 节 | 浏览器和终端都能完成一次正常对话 |\n| 网页正常，Claude Code 连不上 | 第 03、04、07 节 | 终端走到预期代理，认证方式正确 |\n| 已经能用，想每天稳定启动 | 第 09 节 | 新开终端仍能带上代理设置 |\n| 准备清理或重装 | 第 10 节 | 先得到可核对的本地备份 |\n| 页面明确显示账号被封 | 第 12 节 | 保存证据并提交官方申诉 |\n\n准备一个自己保存的笔记，记录下表。**不要把完整记录公开发到 X，也不要填写密码或授权码。**\n\n| 记录项 | 自己填写 |\n| --- | --- |\n| 代理客户端名称、版本 | 例如 Clash Verge Rev，填写实际版本 |\n| 常用节点或代理组 | 记录客户端里显示的名字 |\n| HTTP / Mixed 本地端口 | 稍后在设置中读取，不预设 7897 |\n| 当前模式 | 规则 / 全局；TUN 是否开启 |\n| 浏览器查询到的 IPv4 | 第 03 节填写 |\n| 终端查询到的 IPv4 | 第 04 节填写 |\n| Claude 登录邮箱 | 只自己保存，用于核对账号 |\n| 订阅渠道 | 网页 / Apple / Google Play |\n| Claude Code 版本 | 第 06 节填写 |\n\n**需要准备的东西：**自己的邮箱或 Google 账号、可用的官方订阅、已经配置好合法可用连接的代理客户端。本手册从已有节点开始，不包含购买代理、购买账号或代充的步骤。"
  },
  {
    "id": "02",
    "title": "找到真正的代理端口",
    "summary": "读取当前客户端的真实 HTTP / Mixed 端口，记录模式和节点；不要直接抄图，也不要同时改多项配置。",
    "kind": "local",
    "steps": [
      "从开始菜单或托盘打开 Clash Verge，在“代理”记录当前模式与已选节点；正常工作中的 TUN 先保留。",
      "自动选择或故障转移组在排错时可暂选一个已知可用节点，目的仅是减少出口变化，先记录原状态。",
      "在“设置”找到“系统代理 / System Proxy”；使用系统代理方式时核对其已开启，不把开启系统代理作为所有 TUN 环境的要求。",
      "在端口、Ports 或 Mixed Port 等实际入口读取 HTTP / Mixed 端口；只有 SOCKS 端口时继续找 HTTP / Mixed，Claude Code 不能配置 socks5://。",
      "找不到时可打开 Win + I → 网络和 Internet → 代理 → 手动设置代理，查看“使用代理服务器”的地址和端口；Windows 11 可能需点设置或编辑。",
      "这里先读取，图片的 7897 仅为示例；显示 PAC 设置脚本时仍应返回客户端找 HTTP / Mixed 监听端口。",
      "原来规则模式正常就继续用；查 IP 网站的路线不能代表 Claude 域名路线。",
      "只有自行排错时才考虑临时全局，并明确选择可用节点；全局会影响其他应用，测试结束恢复原模式，再按 08 核对真实连接。"
    ],
    "checkpoints": [
      "已记录真实 HTTP / Mixed 端口、已选节点、原模式、系统代理状态。",
      "此阶段只确认配置信息，不代表网络或 Claude 可用。"
    ],
    "commands": [],
    "links": [
      {
        "label": "Clash Verge 快速入门",
        "url": "https://www.clashverge.dev/guide/quickstart.html"
      },
      {
        "label": "系统代理、TUN 与路由说明",
        "url": "https://www.clashverge.dev/guide/term.html"
      },
      {
        "label": "Claude Code 代理支持",
        "url": "https://code.claude.com/docs/en/network-config"
      }
    ],
    "figures": [
      "windows-port",
      "clash-proxy",
      "clash-settings"
    ],
    "sourceArticleSections": [
      "network"
    ],
    "sourceMarkdown": "# 02 · 找到真正的代理端口\n\n## 2.1 打开客户端，先记录原状态\n\n1. 从开始菜单或任务栏托盘打开 Clash Verge。\n2. 点击左侧“代理”，记下当前模式和已选节点。\n3. 如果正在用“自动选择 / 故障转移”组，排错时可以暂选组内一个可用节点，减少测试中途出口变化；这只是为了方便比较。\n4. 已经正常工作的 TUN 配置先保留。不要为了照搬教程同时改 TUN、DNS、规则和节点。\n\n## 2.2 开启或核对系统代理\n\n1. 点击左侧“设置”。\n2. 找到“系统代理 / System Proxy”。\n3. 如果你使用系统代理方式，让开关处于开启状态。\n4. 不同版本的“端口 / Ports / Mixed Port”入口可能在设置卡片或详细设置中。读取 **HTTP 或 Mixed 端口**，记入表格。\n5. 只看到 SOCKS 端口时，继续查找 HTTP / Mixed 监听设置。Claude Code 的代理配置不支持 SOCKS，不能把 socks5:// 地址填进后面的命令。\n\n**找不到端口时，用 Windows 设置核对：**\n\n1. 按 Win + I，打开“设置”。\n2. 进入“网络和 Internet → 代理”。\n3. 在“手动设置代理”下查看“使用代理服务器”；Windows 11 通常需要点“设置 / 编辑”打开详细窗口。\n4. 查看地址和端口。常见地址是 127.0.0.1，端口以自己窗口为准。\n5. 这里只读取，不把图片里的 7897 强行写入自己的配置。如果显示的是 PAC 设置脚本，返回客户端查 HTTP / Mixed 端口。\n\n[[figure:windows-port]]\n\n## 2.3 规则和全局如何选择\n\n平时原来用规则模式且正常，就继续使用。规则模式可能让不同域名走不同线路，因此“查 IP 网站走代理”不能证明 Claude 也走代理。\n\n排错时如需减少变量，可先记录原模式，临时选“全局”并指定一个可用节点；测试结束后恢复原模式，再按第 08 节检查 Claude 的实际连接。全局模式会影响其他应用流量，不必长期保持。\n\n[[figure:clash-proxy]]\n\n[[figure:clash-settings]]\n\n> **通过标准：**你已经记下实际 HTTP / Mixed 端口、当前节点和原模式，并知道系统代理是否开启。此时还没有证明 Claude 能正常使用。\n\n[Clash Verge 快速入门](https://www.clashverge.dev/guide/quickstart.html) · [系统代理、TUN 与路由说明](https://www.clashverge.dev/guide/term.html) · [Claude Code 代理支持](https://code.claude.com/docs/en/network-config)"
  },
  {
    "id": "03",
    "title": "在浏览器验证，再登录自己的账号",
    "summary": "自行验证浏览器、登录自己的账号；隐私开关和浏览器资料是按需选项。",
    "kind": "network",
    "steps": [
      "浏览器打开 https://api.ipify.org，记下实际 IPv4；203.0.113.10 只是文章的格式示例。",
      "再打开 https://claude.ai，确认出现官方登录页或正常对话页；查 IP 也打不开时先检查客户端，暂不重复注册或付款。",
      "浏览器有代理扩展时核对是否另指定线路，测试只保留自己明确了解的路由方式。",
      "如为减少账号混淆，可在头像菜单新建“Claude”浏览器个人资料；这不能更换设备指纹或保证防封。",
      "选择官方 Google 或邮箱登录，使用长期由自己控制的账号；已有账号沿用原登录方式，按实际页面完成验证。",
      "登录后点左下角头像或名字核对邮箱，发送“请只回复：网页连接正常”，得到回复再继续。",
      "按数据偏好选择：头像 / 名字 → Settings → Privacy → Help Improve our AI models；界面名称可能随版本或语言变化。",
      "Memory、位置权限、时区按实际需要设置，不列入防封必做步骤；关闭模型改进不代表安全检测停止。",
      "登录授权页面、邮件验证码只用于自己发起的官方流程，不发给代充或第三方。"
    ],
    "checkpoints": [
      "自己的邮箱已核对，网页能回复，实际浏览器 IPv4 已记录。",
      "没有将可选隐私或浏览器设置误标为必做配置。"
    ],
    "commands": [],
    "links": [
      {
        "label": "官方账号与 Pro 开通说明",
        "url": "https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan"
      },
      {
        "label": "官方隐私开关说明",
        "url": "https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings"
      },
      {
        "label": "Claude 官方网站",
        "url": "https://claude.ai"
      },
      {
        "label": "IPv4 查询（自行访问会联网）",
        "url": "https://api.ipify.org"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "account",
      "privacy"
    ],
    "sourceMarkdown": "# 03 · 在浏览器验证，再登录自己的账号\n\n## 3.1 先做一次浏览器检查\n\n1. 打开日常使用的 Chrome 或 Edge。\n2. 在地址栏输入 https://api.ipify.org ，按回车。\n3. 页面正常时会显示一串 IPv4 地址，例如 203.0.113.10。这个例子仅展示格式，不能填入自己的配置。\n4. 把实际结果记入第 01 节表格。\n5. 再打开 https://claude.ai 。可以看到登录页，或已有账号的正常对话页，再继续。\n\n如果查 IP 页也打不开，回客户端检查节点、模式和系统代理，先不要反复注册或付款。浏览器有代理扩展时，核对扩展是否另外指定线路；一次只保留自己明确知道的路由方式进行测试。\n\n可选：为了减少账号混淆，可以在浏览器头像菜单中新建一个名为“Claude”的个人资料，专门登录自己的 Claude 账号。它方便管理 Cookie 和账号，**不代表更换了设备指纹，也不能保证防封**。\n\n## 3.2 登录或注册\n\n1. 在 Claude 官方页面选择 Google 登录或邮箱登录。\n2. 使用自己长期能控制的邮箱。已有账号沿用原登录方式，避免误入另一个空白账号。\n3. 如页面要求验证，按官方提示完成；只有实际提供的选项才适用。\n4. 登录后点左下角头像或名字，确认账号邮箱。\n5. 发送一句“请只回复：网页连接正常”。能收到回答，再进行订阅或终端配置。\n\n不要把第三方发送的登录授权页面当成官网，也不要把邮件验证码发给代充或所谓售后。\n\n## 3.3 按自己的偏好设置隐私\n\n希望调整模型改进选项时：**头像 / 名字 → Settings → Privacy → Help Improve our AI models**，按自己的数据使用偏好开关。名称会随语言和版本变化。\n\nMemory、位置权限和时区按实际需要设置。关闭模型改进选项，也不等于平台停止安全检测。它们不列入本手册的“防封必做步骤”。\n\n> **通过标准：**确认自己登录的邮箱，网页能正常回复，并记录浏览器查询到的 IPv4。\n\n[官方账号与 Pro 开通说明](https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan) · [官方隐私开关说明](https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings)"
  },
  {
    "id": "04",
    "title": "让 PowerShell 明确使用同一个本地代理",
    "summary": "系统代理不保证终端跟随；文章先做手动网络核对，再在当前 PowerShell 设置代理。",
    "kind": "network",
    "steps": [
      "打开普通权限 Windows PowerShell 或 PowerShell 7；Windows Terminal 使用 PowerShell 标签，不能把 $env: 命令粘到 CMD。",
      "输入 02 节读到的端口，范围 1–65535；文章的 Test-NetConnection 会探测本地端口，只有你以后主动排错时自行执行。",
      "TcpTestSucceeded 为 True 只证明本机端口可连接；False 先检查客户端、端口和监听，与封禁无直接对应关系。",
      "显式使用本地代理查询终端 IPv4，与 03 节浏览器结果比较；超时、不同结果先检查扩展、规则、自动切换及日志。",
      "IP 相同只代表两个查询当时出口一致，Claude 域名还需到 08 节核对实际连接。",
      "在同一个 PowerShell 设置 HTTP_PROXY、HTTPS_PROXY、NO_PROXY，之后从该窗口启动 Claude Code。",
      "HTTPS_PROXY 以 http://127.0.0.1:端口 开头是本地代理协议，目标仍可为 HTTPS；不要自行换成 https:// 或 socks5://。",
      "已经运行的 Claude Code 不会自动读取后来设置的进程变量；退出后从此窗口重新启动，关闭窗口后这些变量不保留。"
    ],
    "checkpoints": [
      "用户自行验证后，本地端口连通、显式代理 IP 查询成功、当前窗口代理变量已设置。",
      "尚未进行实际网络验证时，保持未验证状态。"
    ],
    "commands": [
      {
        "label": "输入端口并手动探测本机监听",
        "language": "powershell",
        "code": "$claudeProxyPort = [int](Read-Host '输入客户端实际的 HTTP / Mixed 端口')\nif ($claudeProxyPort -lt 1 -or $claudeProxyPort -gt 65535) {\n    throw '端口必须在 1 到 65535 之间'\n}\n$claudeProxyUrl = \"http://127.0.0.1:$claudeProxyPort\"\nTest-NetConnection -ComputerName 127.0.0.1 -Port $claudeProxyPort",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "显式代理查询终端 IPv4",
        "language": "powershell",
        "code": "curl.exe --fail --silent --show-error --connect-timeout 10 --max-time 20 --proxy $claudeProxyUrl https://api.ipify.org",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "仅设置当前 PowerShell 代理",
        "language": "powershell",
        "code": "$env:HTTP_PROXY = $claudeProxyUrl\n$env:HTTPS_PROXY = $claudeProxyUrl\n$env:NO_PROXY = 'localhost,127.0.0.1,::1'",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "Claude Code 官方网络配置",
        "url": "https://code.claude.com/docs/en/network-config"
      },
      {
        "label": "IPv4 查询（自行访问会联网）",
        "url": "https://api.ipify.org"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "network"
    ],
    "sourceMarkdown": "# 04 · 让 PowerShell 明确使用同一个本地代理\n\n**系统代理开关不保证终端会跟随。**本节显式设置当前 PowerShell 的代理，让配置更容易核对。只影响这个窗口及其后续启动的进程，关闭窗口后不保留。\n\n## 4.1 打开正确的终端\n\n1. 按 Win，输入“PowerShell”，打开 Windows PowerShell 或 PowerShell 7。\n2. 不需要以管理员身份运行。\n3. 如果 Windows Terminal 打开的是命令提示符，切换到 PowerShell 标签。下面的 $env: 写法不能直接粘贴到 CMD。\n4. 粘贴下面整段；出现提问时，输入第 02 节查到的数字端口，按回车。\n\n~~~powershell\n$claudeProxyPort = [int](Read-Host '输入客户端实际的 HTTP / Mixed 端口')\nif ($claudeProxyPort -lt 1 -or $claudeProxyPort -gt 65535) {\n    throw '端口必须在 1 到 65535 之间'\n}\n$claudeProxyUrl = \"http://127.0.0.1:$claudeProxyPort\"\nTest-NetConnection -ComputerName 127.0.0.1 -Port $claudeProxyPort\n~~~\n\n输出中寻找 **TcpTestSucceeded : True**。False 表示本机该端口没有连通，通常是客户端未启动、端口填错或未监听。它和账号有没有被封无关。\n\n## 4.2 查询终端出口\n\n继续在同一个窗口执行：\n\n~~~powershell\ncurl.exe --fail --silent --show-error --connect-timeout 10 --max-time 20 --proxy $claudeProxyUrl https://api.ipify.org\n~~~\n\n把结果和浏览器第 03 节的 IPv4 对比。\n\n- 相同：两个测试请求的出口一致，可以继续。\n- 不同：先检查浏览器扩展、客户端规则和自动切换。不要立刻判定账号有问题。\n- 超时或报错：检查节点和客户端日志，先让本条命令成功。\n\n**注意：**查 IP 请求相同，只证明这两个请求当时的出口一致。Claude 相关域名可能被单独分流，还要完成第 08 节。\n\n## 4.3 为后续启动的 Claude Code 设置代理\n\n~~~powershell\n$env:HTTP_PROXY = $claudeProxyUrl\n$env:HTTPS_PROXY = $claudeProxyUrl\n$env:NO_PROXY = 'localhost,127.0.0.1,::1'\n~~~\n\nHTTPS_PROXY 的值以 **http://** 开头是正常的：这里描述本地代理的协议，Claude 请求的目标仍可以是 HTTPS。不要自行改成 https://127.0.0.1 或 socks5://。\n\n设置后再启动 Claude Code。已经运行的 Claude Code 不会自动读取后来修改的环境变量，先退出它，再从这个窗口重新启动。\n\n> **通过标准：**本地端口连通，显式代理的 IP 查询成功，当前窗口已设置 HTTP_PROXY 和 HTTPS_PROXY。\n\n[Claude Code 官方网络配置](https://code.claude.com/docs/en/network-config)"
  },
  {
    "id": "05",
    "title": "在官方渠道开通，并核对是否买到同一个账号",
    "summary": "从自己的官方订阅开始，核对账号、账单渠道和续费；付款成功不代表防封。",
    "kind": "manual",
    "steps": [
      "已有可用于 Claude Code 的 Pro、Max、Team 或 Enterprise 权限，核对状态后跳到 06；免费网页账号不能据此取得 Claude Code 订阅权限。",
      "主线使用自己的 Claude.ai 订阅，Console/API 另行计费，不套用这条路线。",
      "在官网登录刚才的账号，左下角名字 → Settings → Billing；新订阅通常从 Upgrade plan → Get Pro plan 进入，实际按钮以后续页面为准。",
      "选择月付或年付，核对金额、币种、自动续订及税费，使用合法可用的付款方式并填写真实账单信息。",
      "付款后返回 Billing 确认套餐生效，保存订单和下一次续费日期；扣款而权益未变先对照邮箱和订单，不重复购买。",
      "套餐按工作量选择，没有可靠证据证明“先 Pro 养几天再 Max”降低封禁概率。",
      "手机渠道使用官方 iOS / Android Claude 应用，先核对邮箱，再按右上角头像或首字母 → Upgrade to Pro 购买；回同账号网页检查权益同步。",
      "已有网页订阅先核对原渠道，避免两个渠道重复订阅；X 上 Google Play 付款成功只是个人经验，不能复制虚构账单或假定所有卡都可用。"
    ],
    "checkpoints": [
      "Billing 显示所需有效套餐，订阅渠道、订单、续费日期已自己保存。",
      "网页邮箱与稍后 Claude Code 授权的邮箱一致。"
    ],
    "commands": [],
    "links": [
      {
        "label": "网页 Pro 开通说明",
        "url": "https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan"
      },
      {
        "label": "Android 订阅说明",
        "url": "https://support.claude.com/en/articles/9612892-how-do-i-sign-up-for-claude-pro-on-claude-for-android"
      },
      {
        "label": "iOS 订阅说明",
        "url": "https://support.claude.com/en/articles/9266495-how-do-i-sign-up-for-claude-pro-on-the-claude-app-for-ios"
      },
      {
        "label": "Claude 官方账户",
        "url": "https://claude.ai"
      }
    ],
    "figures": [
      "payment"
    ],
    "sourceArticleSections": [
      "payment",
      "account"
    ],
    "sourceMarkdown": "# 05 · 在官方渠道开通，并核对是否买到同一个账号\n\n已有可用于 Claude Code 的 Pro、Max、Team 或 Enterprise 权限，可以直接核对状态后跳到第 06 节。免费网页账号不能据此获得 Claude Code 订阅权限；Console/API 是另一种计费路线，本手册不走那条路线。\n\n## 5.1 Windows 上优先核对网页账单\n\n1. 在 https://claude.ai 登录刚才确认的账号。\n2. 点击左下角名字 → **Settings → Billing**。\n3. 新订阅通常从 **Upgrade plan → Get Pro plan** 进入；套餐按钮以后续官方页面为准。\n4. 选月付或年付，核对金额、币种、自动续订及税费。\n5. 使用自己合法可用的付款方式，填写真实账单信息。\n6. 完成付款后返回 Billing，确认套餐已生效，并保存订单和下一次续费日期。\n7. 已经扣款但权益没变时，先核对登录邮箱和订单，不要连续重复购买。\n\n套餐按工作量选择。没有可靠证据说明“先 Pro 养几天，再升 Max”能降低封禁概率，也不需要为了防封强行购买更贵的套餐。\n\n## 5.2 如果使用手机应用商店订阅\n\n在官方 iOS / Android Claude 应用中，先核对登录邮箱，再按 **右上角头像 / 首字母 → Upgrade to Pro** 完成应用内购买；返回同一账号的网页检查套餐是否同步。已有网页订阅时，先核对原渠道，不要同时在两个渠道重复订阅。\n\nX 上有用户分享 Google Play 付款经历，可以了解路线；能否付款以你实际账号、地区和渠道规则为准。某个人的一张卡成功，不代表所有账号都会成功。\n\n[[figure:payment]]\n\n> **通过标准：**Billing 显示你需要的有效套餐；网页账号与稍后 Claude Code 授权的邮箱一致。\n\n[网页 Pro 开通说明](https://support.claude.com/en/articles/8325609-how-do-i-sign-up-for-the-pro-plan) · [Android 订阅说明](https://support.claude.com/en/articles/9612892-how-do-i-sign-up-for-claude-pro-on-claude-for-android) · [iOS 订阅说明](https://support.claude.com/en/articles/9266495-how-do-i-sign-up-for-claude-pro-on-the-claude-app-for-ios)"
  },
  {
    "id": "06",
    "title": "安装官方 Claude Code",
    "summary": "已有版本先检查，缺少客户端才安装；WinGet 与原生安装选一种，并沿用原渠道更新。",
    "kind": "manual",
    "steps": [
      "先检查 Get-Command claude 与 claude --version；能显示版本就跳到 07，不为教程重装。",
      "缺少客户端时优先用官方 WinGet 包，核对安装器来源和条款；安装会联网，仅由你以后自行执行。",
      "安装完成关闭当前 PowerShell，重新打开以加载 PATH，重新按 04 设置代理，再检查版本和 claude doctor。",
      "doctor 输出随版本变化，只需处理实际启动阻断，不要求逐字对齐截图。",
      "winget 不存在时先检查 Windows 应用安装程序 / App Installer；也可选官方 PowerShell 原生安装，两种方式不要混装。",
      "原生安装命令会下载并执行脚本，先阅读官方安装页并确认 claude.ai 地址；不用来历不明脚本，不永久降低执行策略。",
      "当前文章核对的官方文档将 Git for Windows 列为可选；需要 Bash 或项目需要 Git 再安装，没装 Git 不等于账号异常。",
      "更新沿用原渠道：WinGet 用对应 upgrade 命令，原生安装由其更新机制维护，不额外叠加另一套安装。"
    ],
    "checkpoints": [
      "新终端可识别 claude，版本正常，已处理实际启动阻断。",
      "仅保留自己选定的一种安装和更新渠道。"
    ],
    "commands": [
      {
        "label": "检查现有安装与版本",
        "language": "powershell",
        "code": "Get-Command claude -ErrorAction SilentlyContinue\nclaude --version",
        "network": false,
        "execution": "display-only"
      },
      {
        "label": "通过 WinGet 安装官方客户端",
        "language": "powershell",
        "code": "winget install --id Anthropic.ClaudeCode --exact",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "新终端检查版本与诊断",
        "language": "powershell",
        "code": "claude --version\nclaude doctor",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "官方原生安装（二选一）",
        "language": "powershell",
        "code": "irm https://claude.ai/install.ps1 | iex",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "沿 WinGet 渠道更新",
        "language": "powershell",
        "code": "winget upgrade --id Anthropic.ClaudeCode --exact",
        "network": true,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "官方安装页",
        "url": "https://code.claude.com/docs/en/setup"
      },
      {
        "label": "官方安装与系统要求",
        "url": "https://code.claude.com/docs/en/setup"
      },
      {
        "label": "快速开始",
        "url": "https://code.claude.com/docs/en/quickstart"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "account"
    ],
    "sourceMarkdown": "# 06 · 安装官方 Claude Code\n\n## 6.1 已经安装的人先检查\n\n~~~powershell\nGet-Command claude -ErrorAction SilentlyContinue\nclaude --version\n~~~\n\n能显示版本就先别重装，直接到第 07 节。命令找不到，再进行下面的安装。\n\n## 6.2 优先使用 WinGet\n\n在 PowerShell 中执行：\n\n~~~powershell\nwinget install --id Anthropic.ClaudeCode --exact\n~~~\n\n按安装器提示核对来源和条款。安装成功后，**关闭当前 PowerShell，再打开一个新的 PowerShell**，让新 PATH 生效。重新执行第 04 节设置代理，然后运行：\n\n~~~powershell\nclaude --version\nclaude doctor\n~~~\n\n能看到版本号，doctor 没有阻止启动的问题即可继续。doctor 的具体输出随版本变化，不要求它和网上截图逐字一致。\n\n## 6.3 如果提示 winget 不存在\n\n先检查 Windows“应用安装程序 / App Installer”是否可用；也可选择官方提供的 PowerShell 原生安装方式。两种方式选一种，不在同一台电脑上混着安装。\n\n以下命令会下载并执行 Claude 官方安装脚本。先阅读 [官方安装页](https://code.claude.com/docs/en/setup)，确认地址是 claude.ai 后，才自行执行：\n\n~~~powershell\nirm https://claude.ai/install.ps1 | iex\n~~~\n\n同样在安装后重开终端、设置代理、检查版本。不要从论坛粘贴来历不明的安装脚本，也不需要为了运行本文命令永久降低 PowerShell 执行策略。\n\n当前官方文档把 Git for Windows 列为可选项：需要 Bash 或项目用到 Git 时安装；不要把“没装 Git”直接当作账号异常。以上步骤面向受支持的 Windows 原生环境。\n\n**更新时也沿用原安装渠道：**WinGet 安装可以运行下面的命令；原生安装由其更新机制维护。不要为更新再叠加另一套安装方式。\n\n~~~powershell\nwinget upgrade --id Anthropic.ClaudeCode --exact\n~~~\n\n> **通过标准：**新打开的终端能识别 claude，能显示版本，诊断中没有尚未处理的启动阻断问题。\n\n[官方安装与系统要求](https://code.claude.com/docs/en/setup) · [快速开始](https://code.claude.com/docs/en/quickstart)"
  },
  {
    "id": "07",
    "title": "登录前，排除旧 API / 中转配置干扰",
    "summary": "只显示旧认证变量是否存在，核对 settings 和项目覆盖，再自行走官方订阅授权。",
    "kind": "local",
    "steps": [
      "以前用过 API、中转或 Bedrock、Vertex、Foundry 时，先运行只显示变量名与 IsSet 的检查，不打印密钥值。",
      "全部 False 才能继续按主线判断；有 True 先分清旧配置与仍需使用的团队环境，不能直接删。",
      "确认当前窗口改用个人订阅时，文章给出只清 Process 环境的命令；它不删除用户或系统环境，下次新窗口可能又出现。",
      "仍走旧服务时，检查以前写过的用户 Claude settings 和项目 env/provider 项；先备份再按明确来源撤回，不上传整份配置或删除整个 .claude。",
      "在已设置代理的同一 PowerShell 中运行 claude auth login，选择 Claude.ai 订阅对应方式，不误选 API/Console 账户。",
      "自己的浏览器打开授权页后核对邮箱；未自动打开时按终端提示复制 URL，提供 c 复制选项时才使用。",
      "需要贴回授权码时，只贴回自己发起登录的终端；授权链接、码和密钥不分享。",
      "登录后运行 claude auth status --text 核对认证方式；旧版本不支持时沿原安装渠道更新，或进 Claude 用 /status 查看。"
    ],
    "checkpoints": [
      "官方授权完成，账号与认证路线是自己需要的那一种。",
      "用户、系统、项目或旧 API/中转覆盖尚未排除时，不声明已切换成功。"
    ],
    "commands": [
      {
        "label": "只显示旧认证变量是否存在",
        "language": "powershell",
        "code": "$claudeProviderNames = @(\n    'ANTHROPIC_BASE_URL',\n    'ANTHROPIC_API_KEY',\n    'ANTHROPIC_AUTH_TOKEN',\n    'CLAUDE_CODE_USE_BEDROCK',\n    'CLAUDE_CODE_USE_VERTEX',\n    'CLAUDE_CODE_USE_FOUNDRY'\n)\nforeach ($claudeEnvName in $claudeProviderNames) {\n    [pscustomobject]@{\n        Name = $claudeEnvName\n        IsSet = -not [string]::IsNullOrEmpty(\n            [Environment]::GetEnvironmentVariable($claudeEnvName, 'Process')\n        )\n    }\n}",
        "network": false,
        "execution": "display-only"
      },
      {
        "label": "确认后只清当前进程旧认证变量",
        "language": "powershell",
        "code": "foreach ($claudeEnvName in $claudeProviderNames) {\n    [Environment]::SetEnvironmentVariable($claudeEnvName, $null, 'Process')\n}",
        "network": false,
        "execution": "display-only"
      },
      {
        "label": "自行发起官方登录",
        "language": "powershell",
        "code": "claude auth login",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "查看认证状态",
        "language": "powershell",
        "code": "claude auth status --text",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "官方认证流程",
        "url": "https://code.claude.com/docs/en/authentication"
      },
      {
        "label": "认证命令参考",
        "url": "https://code.claude.com/docs/en/cli-reference"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "account",
      "device"
    ],
    "sourceMarkdown": "# 07 · 登录前，排除旧 API / 中转配置干扰\n\n## 7.1 只查“有没有设置”，不显示密钥\n\n以前用过 API、中转站、Bedrock、Vertex 或 Foundry 的用户，先执行下面的检查。它只显示变量名和是否存在，不打印变量值。\n\n~~~powershell\n$claudeProviderNames = @(\n    'ANTHROPIC_BASE_URL',\n    'ANTHROPIC_API_KEY',\n    'ANTHROPIC_AUTH_TOKEN',\n    'CLAUDE_CODE_USE_BEDROCK',\n    'CLAUDE_CODE_USE_VERTEX',\n    'CLAUDE_CODE_USE_FOUNDRY'\n)\nforeach ($claudeEnvName in $claudeProviderNames) {\n    [pscustomobject]@{\n        Name = $claudeEnvName\n        IsSet = -not [string]::IsNullOrEmpty(\n            [Environment]::GetEnvironmentVariable($claudeEnvName, 'Process')\n        )\n    }\n}\n~~~\n\n全部 False 可以继续。有 True 时，先确认这是你以前主动配置的其他认证路线，还是现在仍需使用的团队环境。**本手册选择个人订阅路线。**\n\n确认只在当前窗口切回个人订阅时，执行：\n\n~~~powershell\nforeach ($claudeEnvName in $claudeProviderNames) {\n    [Environment]::SetEnvironmentVariable($claudeEnvName, $null, 'Process')\n}\n~~~\n\n这不会删除用户级或系统级环境变量。下次新开窗口，旧变量可能重新出现；第 09 节启动器会检查并征求是否暂时忽略，避免悄悄改动其他工作环境。\n\n如果仍然走向旧服务，检查自己以前写过的 Claude settings 文件和项目设置里的 env/provider 项。先备份，再按自己明确知道的配置撤回；不要上传整个配置或直接删除整个 .claude 目录。\n\n## 7.2 发起官方登录\n\n仍在已设置代理的同一个 PowerShell 执行：\n\n~~~powershell\nclaude auth login\n~~~\n\n1. 如果出现认证方式选择，选择与你的 Claude.ai 订阅对应的方式。不要误选 API/Console 账单账户。\n2. 浏览器打开授权页后，核对账号邮箱，再按页面授权。\n3. 浏览器没有自动打开时，按终端提示复制登录 URL；交互式流程提供“c”复制选项时可按 c，再粘贴到自己的浏览器。\n4. 如果流程要求把授权码贴回终端，只贴回自己发起登录的这个终端。\n5. 终端显示登录成功后，继续检查：\n\n~~~powershell\nclaude auth status --text\n~~~\n\n看到已认证状态，并确认使用预期账号/认证方式。旧版本不识别该子命令时，先按原渠道更新，再重试；也可以进入 Claude 后用 /status 查看状态。\n\n> **通过标准：**官方授权完成，认证状态正确，个人订阅没有被旧 API Key 或中转地址覆盖。\n\n[官方认证流程](https://code.claude.com/docs/en/authentication) · [认证命令参考](https://code.claude.com/docs/en/cli-reference)"
  },
  {
    "id": "08",
    "title": "在空目录做一次最小测试",
    "summary": "在专用空目录自行做最小对话，再核对真实 Claude 连接路由；会产生网络和套餐用量。",
    "kind": "network",
    "steps": [
      "文章在 %LOCALAPPDATA%\\ClaudeManual\\smoke-test 创建空目录后启动 Claude，避免初次验证就读整个工作盘。",
      "若询问信任文件夹，先核对实际路径是该 smoke-test，再自行决定。",
      "发送文章指定的最小请求，仅要求回复“终端连接正常”，明确不要读写文件或运行命令；首轮测试会消耗用量。",
      "收到回复后输入 /status 核对状态与认证，不公开完整状态截图。",
      "自行打开 Clash Verge 的连接 / Connections 列表，再刷新 Claude 网页并在终端发送简单请求。",
      "查找实际出现的 claude.ai、api.anthropic.com 等相关主机，核对代理链、节点与命中规则；可能存在其他官方主机。",
      "看不到目标先清空筛选并核对记录保留时间；仍看不到就记录“路由未确认”，不能只凭 IP 查询通过打勾。",
      "临时切过全局的人恢复原模式，再重新核对网页与终端的真实连接。"
    ],
    "checkpoints": [
      "用户自行确认网页与终端均可回复，认证账号正确，实际 Claude 代理链符合预期。",
      "通过只代表当前功能正常，不代表未来不会被限制。"
    ],
    "commands": [
      {
        "label": "创建空目录并自行启动 Claude",
        "language": "powershell",
        "code": "$claudeTestDir = Join-Path $env:LOCALAPPDATA 'ClaudeManual\\smoke-test'\nNew-Item -ItemType Directory -Path $claudeTestDir -Force | Out-Null\nSet-Location -LiteralPath $claudeTestDir\nclaude",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "最小对话提示词（会消耗用量）",
        "language": "text",
        "code": "只回复“终端连接正常”，不要读取、创建或修改任何文件，也不要运行命令。",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "查看交互会话状态",
        "language": "text",
        "code": "/status",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "官方快速开始",
        "url": "https://code.claude.com/docs/en/quickstart"
      },
      {
        "label": "Clash 路由与模式说明",
        "url": "https://www.clashverge.dev/guide/quickstart.html"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "network",
      "account"
    ],
    "sourceMarkdown": "# 08 · 在空目录做一次最小测试\n\n先用专门的空目录验证，避免一上来就让工具读取整个工作盘。\n\n## 8.1 创建测试目录并启动\n\n~~~powershell\n$claudeTestDir = Join-Path $env:LOCALAPPDATA 'ClaudeManual\\smoke-test'\nNew-Item -ItemType Directory -Path $claudeTestDir -Force | Out-Null\nSet-Location -LiteralPath $claudeTestDir\nclaude\n~~~\n\n按界面提示完成必要设置。若询问是否信任当前文件夹，先核对屏幕上的目录确实是刚创建的 smoke-test，再按自己的判断确认。\n\n进入输入区后发送：\n\n~~~text\n只回复“终端连接正常”，不要读取、创建或修改任何文件，也不要运行命令。\n~~~\n\n收到回复后输入：\n\n~~~text\n/status\n~~~\n\n查看当前状态与认证方式；不要把完整状态截图随意公开。首轮测试会消耗套餐用量。\n\n## 8.2 核对 Claude 实际经过的线路\n\n1. 回 Clash Verge，打开“连接 / Connections”。\n2. 保持列表可见，在浏览器刷新 Claude 页面，并在终端再发一次简单请求。\n3. 在连接列表中查找 claude.ai、api.anthropic.com 等实际出现的相关主机；不同版本也可能使用其他官方主机。\n4. 查看每条连接的代理链 / 节点与命中规则，核对是否符合自己的预期。\n5. 看不到目标时，清空搜索筛选、检查连接记录保留时间并重试；仍看不到就暂时保留“路由未确认”，不能仅凭查 IP 成功打勾。\n6. 之前临时改过全局模式的人，恢复原模式，重新测试浏览器与终端的真实连接。\n\n> **通过标准：**网页和终端均能回复；认证账号正确；代理客户端中实际 Claude 连接的路线已核对。以上只代表当前功能正常，不代表未来不会被限制。\n\n[官方快速开始](https://code.claude.com/docs/en/quickstart) · [Clash 路由与模式说明](https://www.clashverge.dev/guide/quickstart.html)"
  },
  {
    "id": "09",
    "title": "每天照这个顺序启动",
    "summary": "每天先准备客户端和终端环境，再进入正确项目；附件启动器仅简化重复步骤。",
    "kind": "manual",
    "steps": [
      "先打开 Clash Verge，核对原有节点、模式及系统代理；正常工作环境按原配置继续。",
      "打开 PowerShell，按 04 输入实际端口并设置当前进程代理；新开 Windows Terminal 或 VS Code 终端不自动继承旧窗口设置。",
      "输入项目完整路径，确认目录存在后切换并启动 Claude；重要项目保持版本管理与独立备份，阅读工具准备执行的命令与改动。",
      "退出 Claude 后关闭窗口，本窗口的代理环境随进程结束。",
      "附件 Test-ClaudeNetwork.ps1 会检查本地端口、代理出口和 HTTP 响应，属于网络操作；这里只展示，不能自动运行。",
      "附件 Launch-Claude.ps1 接收端口和项目目录，结束后恢复原进程环境与目录；遇旧认证变量只显示名字，输入大写 YES 才暂时忽略，其余输入取消。",
      "附件 Backup-ClaudeLocal.ps1 复制本地配置，具体范围和凭据注意点见 10。",
      "先看下载脚本内容；在资源管理器脚本目录地址栏输入 powershell 再执行对应命令。策略阻止时用手动启动步骤，不改组织或系统执行策略。",
      "检查脚本的 HTTP 403 不能判定封禁，可能是浏览器挑战；按 12 分类排错。"
    ],
    "checkpoints": [
      "关闭并重新打开终端后，能按记录重新设置代理并从正确项目启动。",
      "脚本未替自己永久改动系统环境，原工作环境和备份范围已明确。"
    ],
    "commands": [
      {
        "label": "进入确认过的项目再启动",
        "language": "powershell",
        "code": "$claudeProjectDir = Read-Host '粘贴项目文件夹完整路径，不需要外加引号'\nif (-not (Test-Path -LiteralPath $claudeProjectDir -PathType Container)) {\n    throw '文件夹不存在，请核对路径'\n}\nSet-Location -LiteralPath $claudeProjectDir\nclaude",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "附件：网络检查（仅展示）",
        "language": "powershell",
        "code": ".\\Test-ClaudeNetwork.ps1",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "附件：按当前窗口环境启动",
        "language": "powershell",
        "code": ".\\Launch-Claude.ps1",
        "network": true,
        "execution": "display-only"
      },
      {
        "label": "附件：完整本地配置备份",
        "language": "powershell",
        "code": ".\\Backup-ClaudeLocal.ps1",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [],
    "figures": [],
    "sourceArticleSections": [
      "network",
      "checklist"
    ],
    "sourceMarkdown": "# 09 · 每天照这个顺序启动\n\n## 9.1 手动启动版\n\n1. 先启动 Clash Verge，核对节点、模式和系统代理。\n2. 打开 PowerShell，执行第 04 节的端口输入与环境变量设置。\n3. 切换到自己要工作的项目文件夹，再启动 Claude：\n\n~~~powershell\n$claudeProjectDir = Read-Host '粘贴项目文件夹完整路径，不需要外加引号'\nif (-not (Test-Path -LiteralPath $claudeProjectDir -PathType Container)) {\n    throw '文件夹不存在，请核对路径'\n}\nSet-Location -LiteralPath $claudeProjectDir\nclaude\n~~~\n\n4. 进项目之前先确认目录。重要项目使用自己的版本管理和备份；需要执行命令或改文件时，阅读 Claude 展示的内容再操作。\n5. 退出时按终端提示正常退出 Claude；关闭窗口后，本窗口设置的代理变量随进程结束。\n\n**特别容易漏：**在旧窗口设置过代理，不代表新开的 Windows Terminal、VS Code 终端也继承了那些设置。新开终端重新设置，或用下面的启动器。\n\n## 9.2 附件脚本版：少复制几遍命令\n\n本地 HTML 顶部可下载 3 个脚本，完整工具包也包含 scripts 文件夹。先看脚本内容，再执行。脚本提示为英文，依次输入端口和项目路径即可。\n\n| 文件 | 做什么 | 你需要输入 |\n| --- | --- | --- |\n| Test-ClaudeNetwork.ps1 | 检查本地端口、代理出口和网页 HTTP 响应；只显示配置变量是否存在 | 实际 HTTP / Mixed 端口 |\n| Launch-Claude.ps1 | 为启动的 Claude 设置进程代理；结束后恢复原环境和工作目录 | 端口、已有项目目录；有旧认证变量时自行确认 |\n| Backup-ClaudeLocal.ps1 | 把本地 Claude 配置复制到本机备份目录 | 默认无；自定义目录见第 10 节 |\n\n**怎么运行下载后的脚本：**\n\n1. 在资源管理器打开保存脚本的文件夹。\n2. 在地址栏输入 powershell，按回车。\n3. 在打开的 PowerShell 中执行相应一行：\n\n~~~powershell\n.\\Test-ClaudeNetwork.ps1\n~~~\n\n~~~powershell\n.\\Launch-Claude.ps1\n~~~\n\n~~~powershell\n.\\Backup-ClaudeLocal.ps1\n~~~\n\n启动器遇到旧 API/云厂商变量时，只列出名字，要求输入大写 YES 才会在本次运行中暂时忽略；其他输入则取消。退出 Claude 后会恢复先前的进程变量，不会写入系统设置。\n\n如果 PowerShell 提示脚本被策略阻止，**直接回到本节手动启动版**，无需为了教程修改组织策略或系统执行策略。也可以只阅读脚本，按前面已经展开的命令逐项操作。\n\n检查脚本遇到网页 HTTP 403，不等于检测到封禁；它只说明服务器给了该 HTTP 响应，可能还需浏览器挑战。以网页登录结果和第 12 节分类排查为准。"
  },
  {
    "id": "10",
    "title": "清理、重装之前，先留一份本地备份",
    "summary": "清理或重装前复制完整 .claude 配置目录与已有 .claude.json；局部 settings 备份不能代替它。",
    "kind": "local",
    "steps": [
      "先正常退出 Claude Code；同时开着 Claude Desktop 也退出，再运行附件 Backup-ClaudeLocal.ps1。",
      "默认来源为 CLAUDE_CONFIG_DIR；未设置时是 %USERPROFILE%\\.claude，备份整个配置目录，不只 settings.json。",
      "默认目标为 %LOCALAPPDATA%\\ClaudeManual\\backups 下的独立时间戳文件夹。",
      "看到 Backup saved 后打开目标，核对 config 子文件夹和 manifest.json；存在用户 .claude.json 时还应有 user-claude.json。",
      "保留原文件，备份脚本只复制不删除；备份可能含仍有效的登录凭据与会话，不公开共享、不发客服、不提交 Git。",
      "本地配置备份不包含所有云端聊天或项目源码，项目另行备份，也不能当作账号恢复工具。",
      "脚本不可用时，Win + R 打开 %USERPROFILE% 或自定义配置目录，再在 %LOCALAPPDATA% 新建 ClaudeManual\\backups\\手动日期，复制配置目录和已有 .claude.json；核对文件，不能剪切。",
      "恢复前先退出 Claude 并另存当前副本；优先恢复明确损坏的一项，确需整体回退时核对 manifest 来源再复制回对应路径。",
      "凭据不跨账号或跨机器混用；登录问题优先走 07 重新认证。工具箱自动保存的 settings.json 修改备份，只覆盖那一份文件，不能替代文章完整备份。"
    ],
    "checkpoints": [
      "完整配置目录和已有 .claude.json 已复制到独立本地目录并核对。",
      "原文件仍保留，备份私密保存，项目源码另有备份。"
    ],
    "commands": [],
    "links": [
      {
        "label": "官方凭据与配置位置说明",
        "url": "https://code.claude.com/docs/en/authentication"
      }
    ],
    "figures": [],
    "sourceArticleSections": [
      "device",
      "checklist"
    ],
    "sourceMarkdown": "# 10 · 清理、重装之前，先留一份本地备份\n\n## 10.1 使用附件备份脚本\n\n1. 正常退出 Claude Code；如果同时开着 Claude Desktop，也先退出。\n2. 在 scripts 文件夹的 PowerShell 中运行 Backup-ClaudeLocal.ps1。\n3. 默认读取当前 CLAUDE_CONFIG_DIR；没有设置时读取用户目录下的 .claude。\n4. 备份默认写到 **%LOCALAPPDATA%\\ClaudeManual\\backups** 下的独立时间戳文件夹。\n5. 脚本显示 Backup saved 后，在资源管理器打开该路径，核对 config 子文件夹和 manifest.json。存在用户目录 .claude.json 时，还会复制为 user-claude.json。\n6. 保留原文件，先不要清理。脚本只有复制，没有删除操作。\n\n备份可能包含仍有效的登录凭据和会话。不要上传网盘共享链接、发给客服或提交进 Git。它不包含所有云端聊天和项目源码；项目文件另行备份，不能把本地配置备份当成账号恢复工具。\n\n## 10.2 脚本不能运行时的手动版\n\n1. 按 Win + R，输入 %USERPROFILE% ，回车。\n2. 打开 .claude 文件夹；如果你设置过 CLAUDE_CONFIG_DIR，则打开自己设置的那个目录。\n3. 按 Win + R，输入 %LOCALAPPDATA% ，新建 ClaudeManual\\backups\\手动日期 文件夹。\n4. 把配置文件夹**复制**进去；用户目录存在 .claude.json 时也复制一份。\n5. 核对备份中能看到原有文件。不要把“剪切”当成备份。\n\n## 10.3 要恢复时怎么做\n\n先退出 Claude，再保留当前配置的另一份副本。确认具体损坏的是哪个设置后，优先只恢复那项设置。若确需整体回退，核对 manifest 的来源目录，再将备份复制回对应路径。凭据不适合跨账号、跨机器混用，登录问题优先走第 07 节重新认证。\n\n[官方凭据与配置位置说明](https://code.claude.com/docs/en/authentication)"
  },
  {
    "id": "11",
    "title": "X 教程里的做法，哪些值得留下",
    "summary": "社区经验保持原证据强度；时区、位置、Memory、指纹浏览器和 CCBaga 都是可选。",
    "kind": "optional",
    "steps": [
      "本节只覆盖此次收集的帖子，不宣称遍历全部 X 教程，也不给任何做法虚构成功率。",
      "固定设备和常用出口可减少排错变量；静态住宅 IP 与 VPS 都有个人案例，没有证据证明某一种必然防封或必须美国出口。",
      "台北时区和关闭位置权限按需求设置，防封效果未证实；模型改进与 Memory 按数据和使用偏好选择。",
      "使用自己长期管理的账号；买两年老 Google 账号不是官方要求，归属与找回更难核验。",
      "Pro → Max 只可作为预算选择，不能当风控规律；官方 Apple / Google Play 可作为付款渠道选项，不能照搬虚构账单。",
      "旧设备有明确故障才先备份后针对性处理，不能推断必须换机器、重置指纹或清空浏览器资料。",
      "卡兹克案例观察期仅六天，泊舟刚完成注册和使用；还有熟悉配置的人仍被封的反例，短期成功不等于长期稳定。",
      "日常能用就跳过 CCBaga；确需使用时从 liseami/CCBaga 官方 Releases 和 Windows 文档选择匹配架构的安装包。",
      "有 SHA256SUMS 时对安装包运行文件哈希并逐字核对同名条目；安装被系统或组织阻止先查签名、来源、规定，不关闭安全保护。",
      "清理前按 10 完整备份并核对删除范围；“清除全部浏览器数据”“直接删除”可能不可恢复，不为绿色状态清空在用资料。绿色仅描述已测项目，不保证匿名、账号接受或防封。"
    ],
    "checkpoints": [
      "全部社区经验保持可选，未按防封必做项执行或宣传。",
      "若选用 CCBaga，来源、哈希与清理范围已自行核对，完整备份在先。"
    ],
    "commands": [
      {
        "label": "校验自己下载的 CCBaga 安装包",
        "language": "powershell",
        "code": "$ccbagaInstaller = Read-Host '粘贴已下载安装包的完整路径，不需要外加引号'\nGet-FileHash -LiteralPath $ccbagaInstaller -Algorithm SHA256",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "liseami/CCBaga 官方仓库",
        "url": "https://github.com/liseami/CCBaga"
      },
      {
        "label": "卡兹克",
        "url": "https://x.com/Khazix0918/status/2105299706549096697"
      },
      {
        "label": "泊舟",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      },
      {
        "label": "夙愿学长",
        "url": "https://x.com/suyuan1711/status/2101889428587421918"
      },
      {
        "label": "黄小木",
        "url": "https://x.com/ai_xiaomu/status/2064197041451102343"
      },
      {
        "label": "CCBaga 介绍",
        "url": "https://x.com/LinearUncle/status/2109477165637222693"
      },
      {
        "label": "丁小屁的质疑",
        "url": "https://x.com/ding98709897/status/2112512237353283672"
      },
      {
        "label": "铁锤人的反例",
        "url": "https://x.com/lxfater/status/2105479545071833164"
      },
      {
        "label": "CCBaga Windows 文档",
        "url": "https://github.com/liseami/CCBaga/blob/main/docs/windows.md"
      }
    ],
    "figures": [
      "evidence",
      "ccbaga"
    ],
    "sourceArticleSections": [
      "network",
      "device",
      "privacy",
      "payment",
      "evidence"
    ],
    "sourceMarkdown": "# 11 · X 教程里的做法，哪些值得留下\n\n本节覆盖本次已收集的帖子，不代表遍历了 X 上所有教程。主线保留的是便于核对和维护的操作；个人短期经历按原有证据强度呈现。\n\n| 教程中的做法 | 本手册怎么处理 | 依据和注意点 |\n| --- | --- | --- |\n| 固定设备、固定常用出口 | 可用于减少排错变量 | 卡兹克用固定设备与静态住宅 IP；泊舟用 VPS。没有足够证据证明某一类 IP 必然防封 |\n| 台北时区、关闭位置权限 | 按实际需求设置 | 多篇帖子提到，未证实防封效果 |\n| 老 Google 账号 | 使用自己能长期管理的账号 | “买两年老号”不是官方要求，账号归属和找回更难核验 |\n| 先 Pro 再 Max | 按需求控制预算 | 不能把套餐升级顺序当成风控规律 |\n| Google Play / Apple 付款 | 可核对的官方渠道选项 | 某张卡成功只代表个人经历，不应复制虚构账单信息 |\n| 清理旧机器的 Claude 记录 | 有明确故障、先备份再处理 | 旧凭据冲突可以排查；不能由“旧机器”推断必须重置设备 |\n| CCBaga 绿色校验 | 可选辅助检查 | 项目明确不保证匿名、账号被接受或不封禁 |\n\n[[figure:evidence]]\n\n卡兹克原帖当时只观察了 6 天；泊舟描述的是刚完成注册、付款和使用。铁锤人的分享也出现了熟悉配置的人仍被封的反例。因而本手册不会给这些做法标“成功率”。\n\n## 可选：确实需要 CCBaga 时\n\n日常能用的人跳过本段。需要核对它实际能检查什么时：\n\n1. 从 [liseami/CCBaga 官方仓库](https://github.com/liseami/CCBaga) 的 Releases 进入，按项目 Windows 文档选择与你系统架构匹配的安装包。\n2. 发布页提供 SHA256SUMS 时，下载对应校验文件，对安装包运行下方命令，再逐字核对同文件名的 SHA256 值。\n3. 如果系统或组织阻止安装，先核查签名、来源及组织规定；不要关闭安全防护来强行安装。\n4. 打开工具先读检测项的含义。要清理时先用第 10 节备份，再核对工具预览的删除范围。\n5. 遇到“清除全部浏览器数据”“直接删除”等选项，确认其不可恢复范围后再自行决定。不要为了凑齐绿色状态把正在使用的浏览器资料清空。\n\n~~~powershell\n$ccbagaInstaller = Read-Host '粘贴已下载安装包的完整路径，不需要外加引号'\nGet-FileHash -LiteralPath $ccbagaInstaller -Algorithm SHA256\n~~~\n\n[[figure:ccbaga]]\n\n原帖来源：[卡兹克](https://x.com/Khazix0918/status/2105299706549096697) · [泊舟](https://x.com/bozhou_ai/status/2109836627539558676) · [夙愿学长](https://x.com/suyuan1711/status/2101889428587421918) · [黄小木](https://x.com/ai_xiaomu/status/2064197041451102343) · [CCBaga 介绍](https://x.com/LinearUncle/status/2109477165637222693) · [丁小屁的质疑](https://x.com/ding98709897/status/2112512237353283672) · [铁锤人的反例](https://x.com/lxfater/status/2105479545071833164)\n\n工具依据：[CCBaga Windows 文档](https://github.com/liseami/CCBaga/blob/main/docs/windows.md)。作者宣传语保留在真实截图中，不作为本手册的结论。"
  },
  {
    "id": "12",
    "title": "出问题时，先对照症状",
    "summary": "按症状区分端口、路由、安装、认证、账单、额度和封禁；明确封禁保留证据再申诉。",
    "kind": "manual",
    "steps": [
      "端口检查 False 或浏览器正常而 curl 失败：先核对客户端运行、HTTP/Mixed 端口协议、节点与日志，不先改账号。",
      "浏览器与终端 IP 不同：检查扩展、自动切换和规则，再按 08 看实际 Claude 连接；curl 403 而浏览器正常可能是挑战或访问控制。",
      "找不到 claude：重开 PowerShell、查官方安装和 PATH，不重复混装。已登录却走 API 余额：核对 07 的变量、settings 和认证路线。",
      "已付款没权限：核对网页/终端邮箱、Billing 与订单渠道，避免重复下单。429、额度和等待重置本身不等于封禁。",
      "证书或 TLS 错误：检查系统时间、代理证书和组织网络要求，按官方文档处理，不使用 -k 或关闭证书验证。",
      "只有退出客户端后普通网页仍被旧本地代理阻断时，才手动进入 Win + I → 网络和 Internet → 代理 → 手动设置代理 → 使用代理服务器，关闭并按需保存。",
      "恢复普通网页只解决残留系统代理；下次启动 Claude 仍需恢复自己的代理并按 04 核对，公司设备依组织要求处理。",
      "明确显示 disabled/banned：保留限制提示、邮件、时间及时区、订单编号，不先清理本地记录或工作文件。",
      "在自己浏览器登录原账号并打开 https://claude.ai/restricted，按页面申诉；组织 on hold 时使用 Request review。",
      "如实说明何时、何页、什么提示、为何认为需复核，附必要订单证明，不编造所在地或经历；记下提交日期与官方回复渠道，不公开卡号或凭据。"
    ],
    "checkpoints": [
      "症状已分类，没有将普通连接、403 或额度错误直接当封禁。",
      "若明确封禁，证据已保存并由自己通过官方页面申诉，配置和工作文件仍保留。"
    ],
    "commands": [
      {
        "label": "官方申诉事实模板",
        "language": "text",
        "code": "账号邮箱：\n发生时间与时区：\n页面显示的完整提示：\n当时正在进行的操作：\n我认为需要复核的事实：\n订阅渠道与订单编号（如有）：\n希望确认的问题：",
        "network": false,
        "execution": "display-only"
      }
    ],
    "links": [
      {
        "label": "Clash Verge 官方 Windows 排错说明",
        "url": "https://www.clashverge.dev/faq/windows.html"
      },
      {
        "label": "官方封禁原因与申诉说明",
        "url": "https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals"
      },
      {
        "label": "原账号登录后的官方申诉入口",
        "url": "https://claude.ai/restricted"
      }
    ],
    "figures": [
      "windows-recovery",
      "official"
    ],
    "sourceArticleSections": [
      "appeal",
      "official"
    ],
    "sourceMarkdown": "# 12 · 出问题时，先对照症状\n\n| 看到的情况 | 先做什么 | 下一步 |\n| --- | --- | --- |\n| TcpTestSucceeded 为 False | 确认客户端已运行，重读 HTTP/Mixed 端口 | 修正后重跑第 04 节；先不动账号 |\n| 浏览器能用，curl 走代理失败 | 核对端口协议、节点和客户端日志 | 确认没有把 SOCKS 端口当 HTTP |\n| 浏览器和终端 IP 不同 | 检查浏览器扩展、自动切换和分流 | 按第 08 节看真实 Claude 连接 |\n| curl 返回 403，浏览器正常 | 可能是浏览器挑战或访问控制 | 用实际登录与对话判断；不能据此判封号 |\n| 终端找不到 claude | 重开 PowerShell，再查版本 | 检查官方安装结果与 PATH，别重复混装 |\n| 显示登录成功，但走 API/扣 API 余额 | 查第 07 节变量及原有 settings | 核对认证方式，重新登录所需路线 |\n| 付了款，但提示没有订阅权限 | 对照网页和终端的账号邮箱、Billing | 检查订单渠道，避免重复下单 |\n| 提示额度、429 或需等待重置 | 按界面显示查看限额和恢复时间 | 限额提示本身不能当作封号证据 |\n| 证书错误、TLS 验证失败 | 检查系统时间、代理证书与组织网络要求 | 按官方网络文档处理；不要用 -k 或关闭证书验证 |\n| 退出 Clash 后普通网页也断网 | 可能系统代理仍指向已关闭的本地端口 | 按下方恢复 Windows 普通网络 |\n| 页面明确显示账号 disabled/banned | 保留提示、邮件和订单 | 走官方申诉；不先清理本地记录 |\n\n## 12.1 退出代理客户端后，恢复普通网络\n\n仅在你已退出客户端、Windows 仍把流量送到旧本地端口时使用：\n\n1. Win + I → 网络和 Internet → 代理。\n2. 找到“手动设置代理 → 使用代理服务器”。\n3. 关闭该开关；有“保存”按钮则保存。\n4. 先验证日常普通网页是否恢复。\n5. 下次要按本手册启动 Claude 时，重新启动客户端，恢复自己原有代理设置，并重做第 04 节检查。\n\n这一步只处理残留的 Windows 代理设置，不代表 Claude 访问路线已经恢复。公司管理的代理设置先按组织要求处理。\n\n[[figure:windows-recovery]]\n\n[Clash Verge 官方 Windows 排错说明](https://www.clashverge.dev/faq/windows.html)\n\n## 12.2 明确封禁时怎么提交申诉\n\n1. 保存完整限制提示、收到的邮件、发生时间与时区、订单编号。不要公开支付卡号和登录凭据。\n2. 在自己的浏览器登录原账号，打开 https://claude.ai/restricted 。\n3. 按页面提供的申诉流程填写；组织显示 on hold 时，使用页面的 Request review 入口。\n4. 用事实说明“何时、什么页面、显示什么、为何认为误判”，附必要订单证明。不要编造所在地或使用经历。\n5. 记下提交日期和官方回复渠道，等待处理；保留现有配置与工作文件。\n\n可直接按下面的结构填写，再删去不适用的项：\n\n~~~text\n账号邮箱：\n发生时间与时区：\n页面显示的完整提示：\n当时正在进行的操作：\n我认为需要复核的事实：\n订阅渠道与订单编号（如有）：\n希望确认的问题：\n~~~\n\n[[figure:official]]\n\n[官方封禁原因与申诉说明](https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals)"
  },
  {
    "id": "13",
    "title": "最后核对一次，再开始日常工作",
    "summary": "按文章逐项自查，只有实际完成的项目才能打勾；配置写入成功不能替代网络和账号验证。",
    "kind": "manual",
    "steps": [
      "核对地区与使用资格，记录真实 HTTP/Mixed 端口，不照抄截图。",
      "确认网页正常对话、邮箱正确，PowerShell 显式代理查询成功。",
      "实际查看 Claude 代理链，不能仅看 IP 查询；CLI 版本和认证方式符合自己的路线。",
      "空目录测试能回复，关闭再打开 PowerShell 后仍能按 09 启动。",
      "付款订单、续费日期、完整配置备份由自己保管，工作文件另行保存。",
      "没有把某个时区、套餐、IP 类型或绿色状态当防封保证；后续按 12 每次只改一项。",
      "资料核对日期为 2026 年 10 月 24 日，后续官方界面和政策可能变化；配图都是真实来源节选，包含旧版 macOS 示例，Windows 路径已另列。"
    ],
    "checkpoints": [
      "已核对自己的使用资格和支持地区。",
      "已记下实际 HTTP/Mixed 端口，不是直接抄配图。",
      "浏览器可正常对话，账号邮箱正确。",
      "PowerShell 显式代理查询成功。",
      "已查看 Claude 的实际代理链，而不只查 IP。",
      "Claude Code 版本正常，认证路线是自己需要的那一种。",
      "空目录中的终端测试能回复。",
      "关闭并重新打开 PowerShell 后，用第 09 节方法仍能启动。",
      "付款订单、续费日期和配置备份由自己保管。",
      "没有把某个时区、套餐、IP 类型或绿色检测结果当成防封保证。"
    ],
    "commands": [],
    "links": [],
    "figures": [],
    "sourceArticleSections": [
      "checklist",
      "evidence"
    ],
    "sourceMarkdown": "# 13 · 最后核对一次，再开始日常工作\n\n- [ ] 已核对自己的使用资格和支持地区。\n- [ ] 已记下实际 HTTP/Mixed 端口，不是直接抄配图。\n- [ ] 浏览器可正常对话，账号邮箱正确。\n- [ ] PowerShell 显式代理查询成功。\n- [ ] 已查看 Claude 的实际代理链，而不只查 IP。\n- [ ] Claude Code 版本正常，认证路线是自己需要的那一种。\n- [ ] 空目录中的终端测试能回复。\n- [ ] 关闭并重新打开 PowerShell 后，用第 09 节方法仍能启动。\n- [ ] 付款订单、续费日期和配置备份由自己保管。\n- [ ] 没有把某个时区、套餐、IP 类型或绿色检测结果当成防封保证。\n\n全部完成，表示这套环境已经能按记录重现。后续有问题，先按第 12 节对应症状排查，一次只改一项。\n\n资料核对于 2026 年 10 月 24 日。配图均为真实网页 / 官方文档截图节选，图下注明出处；Clash 界面示例包含旧版及 macOS 截图，Windows 路径已另列。本文没有伪造 Claude 登录界面，也没有实际操作你的代理、账号或订阅。"
  }
];

export const claudeHandbookOptionalItems: ClaudeHandbookOptionalItem[] = [
  {
    "id": "timezone",
    "title": "时区与台北时区",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "卡兹克与泊舟推荐台北时区，属于个人经验；防封效果未证实，不能代替支持地区与使用资格要求。",
    "steps": [
      "按实际工作、行程和时间显示需要选择时区，正常使用环境保持原状即可。",
      "文章没有要求统一改为台北，也没有给出必须执行的时区命令；不要把该项列为通过条件。"
    ],
    "links": [
      {
        "label": "相关社区建议原帖",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      }
    ]
  },
  {
    "id": "location",
    "title": "系统或网页位置权限",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "社区建议关闭定位；实际应按隐私需求选择，防封效果未证实。",
    "steps": [
      "按自己对系统与网页定位的使用需求决定是否允许，不因教程默认关掉。",
      "关闭位置权限不改变自己的实际使用资格，也不证明平台停止安全检测。"
    ],
    "links": [
      {
        "label": "相关社区建议原帖",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      }
    ]
  },
  {
    "id": "model-improvement",
    "title": "Help Improve our AI models",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy"
    ],
    "required": false,
    "evidence": "preference",
    "evidenceNote": "官方隐私开关有明确用途，是否打开由数据使用偏好决定；防封效果未证实，关闭后不代表停止安全检测。",
    "steps": [
      "自己登录后，按文章核实的路径：头像 / 名字 → Settings → Privacy → Help Improve our AI models。",
      "依据自己的数据使用偏好开关；名称可能随语言、版本变化，不需要为防封强行关闭。"
    ],
    "links": [
      {
        "label": "官方模型改进隐私设置",
        "url": "https://privacy.claude.com/en/articles/12109829-how-do-i-change-my-model-improvement-privacy-settings"
      }
    ]
  },
  {
    "id": "memory",
    "title": "Memory 记忆功能",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy"
    ],
    "required": false,
    "evidence": "preference",
    "evidenceNote": "泊舟建议关闭 Memory；文章要求按是否需要记忆功能决定，防封效果未证实。",
    "steps": [
      "需要跨会话记忆就按自己的需求使用，不为凑齐防封开关默认关闭。",
      "文章没有核实 Memory 的固定菜单路径，以自己的实际界面与官方说明为准；不编造点击路径。"
    ],
    "links": [
      {
        "label": "相关社区建议原帖",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      }
    ]
  },
  {
    "id": "browser-profile",
    "title": "独立的浏览器个人资料",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy",
      "account"
    ],
    "required": false,
    "evidence": "convenience",
    "evidenceNote": "独立资料方便区分 Cookie 和账号，不等于改变设备指纹；防封效果未证实。",
    "steps": [
      "如确需减少账号混淆，可在浏览器头像菜单新建名为“Claude”的个人资料，专门登录自己的账号。",
      "原浏览器已正常使用可以跳过，不清空正在使用的资料。"
    ],
    "links": [
      {
        "label": "Claude 官方登录",
        "url": "https://claude.ai"
      }
    ]
  },
  {
    "id": "fingerprint-browser",
    "title": "指纹浏览器",
    "sourceSections": [
      "03",
      "11"
    ],
    "articleSections": [
      "privacy"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "部分教程推荐独立浏览器环境；文章只承认便于管理环境，不保证防封，也未证明必须换设备指纹。",
    "steps": [
      "普通浏览器个人资料已满足账号管理需要时，不额外安装。",
      "文章没有要求购买指纹浏览器或重置设备；使用工具前先明确范围，不删现有浏览器数据。"
    ],
    "links": [
      {
        "label": "相关社区建议原帖",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      }
    ]
  },
  {
    "id": "fixed-device",
    "title": "固定常用设备",
    "sourceSections": [
      "02",
      "11"
    ],
    "articleSections": [
      "network",
      "device",
      "evidence"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "卡兹克固定一台设备并远程使用的经历可减少环境变化；降低封号概率仍未证实。换新电脑和清理旧电脑都有个案，不能推导必须更换设备。",
    "steps": [
      "记录常用设备，排错时减少同时变化的条件。",
      "已有正常机器保持原状；有明确旧凭据或配置故障，先完整备份再针对性处理。"
    ],
    "links": [
      {
        "label": "卡兹克原帖",
        "url": "https://x.com/Khazix0918/status/2105299706549096697"
      },
      {
        "label": "夙愿学长旧设备经历",
        "url": "https://x.com/suyuan1711/status/2101889428587421918"
      }
    ]
  },
  {
    "id": "fixed-exit",
    "title": "固定常用出口与节点",
    "sourceSections": [
      "02",
      "11"
    ],
    "articleSections": [
      "network",
      "evidence"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "静态住宅 IP 与独享 VPS 都有个人案例；固定出口便于比较，防封效果未证实，没有证据证明某类 IP 必然更好或必须美国。",
    "steps": [
      "记录原节点、代理组和模式；排错时才考虑暂选组内已知可用节点，避免测试中途自动切换。",
      "原规则模式正常就继续；不为了文章购买住宅 IP、VPS 或强制换地区，改动后按原步骤自行核对实际连接。"
    ],
    "links": [
      {
        "label": "卡兹克原帖",
        "url": "https://x.com/Khazix0918/status/2105299706549096697"
      },
      {
        "label": "泊舟原帖",
        "url": "https://x.com/bozhou_ai/status/2109836627539558676"
      }
    ]
  },
  {
    "id": "ccbaga",
    "title": "CCBaga 辅助检查与清理",
    "sourceSections": [
      "10",
      "11"
    ],
    "articleSections": [
      "device",
      "evidence"
    ],
    "required": false,
    "evidence": "unverified",
    "evidenceNote": "项目明确说明绿色只描述已测项目，不保证匿名、账号被接受或不封禁。作者宣传不是文章结论，正常可用环境直接跳过。",
    "steps": [
      "确需使用时从 liseami/CCBaga 官方 Releases 与 Windows 文档选择匹配架构的安装包。",
      "有 SHA256SUMS 时按文章命令校验同名安装包；系统或组织阻止安装先查来源、签名和规则，不关闭安全防护。",
      "清理之前按第 10 节备份完整 .claude 和已有 .claude.json，再看每项检测与删除范围。",
      "“清除全部浏览器数据”与“直接删除”可能不可恢复，不为全绿清空在用资料；此指南不会自动下载、执行或清理。"
    ],
    "links": [
      {
        "label": "CCBaga 官方仓库",
        "url": "https://github.com/liseami/CCBaga"
      },
      {
        "label": "CCBaga Windows 文档",
        "url": "https://github.com/liseami/CCBaga/blob/main/docs/windows.md"
      }
    ]
  }
];

export const claudeHandbookFigures: ClaudeHandbookFigure[] = [
  {
    "id": "windows-port",
    "file": "07-windows-proxy.png",
    "caption": "Windows：在手动代理窗口读取地址与端口",
    "note": "Clash Verge 官方 FAQ 真实截图。图中 7897 只是示例，填写你自己窗口里的端口。",
    "source": "https://www.clashverge.dev/faq/windows.html"
  },
  {
    "id": "clash-proxy",
    "file": "05-clash-proxy.png",
    "caption": "Clash Verge：代理页面与模式选择的位置",
    "note": "官方快速入门截图，界面为旧版 macOS 示例；Windows 同类入口名称相近。图中节点品牌不是推荐。",
    "source": "https://www.clashverge.dev/guide/quickstart.html"
  },
  {
    "id": "clash-settings",
    "file": "06-clash-settings.png",
    "caption": "Clash Verge：设置中的系统代理与 TUN",
    "note": "官方旧版 macOS 界面示例，用来定位两个不同的开关；不要照抄图里的 TUN 状态。",
    "source": "https://www.clashverge.dev/guide/quickstart.html"
  },
  {
    "id": "payment",
    "file": "03-google-play-reply.jpg",
    "caption": "X 原帖：用户补充 Google Play 订阅经历",
    "note": "真实回复节选，属于个人付款经历，不能推导为所有卡或账号均可使用。",
    "source": "https://x.com/Khazix0918/status/2105327306730521054"
  },
  {
    "id": "evidence",
    "file": "02-x-six-days.jpg",
    "caption": "X 原帖：当时的观察期只有六天",
    "note": "原文短句节选；完整语境请打开来源。短期可用不等于长期稳定。",
    "source": "https://x.com/Khazix0918/status/2105299706549096697"
  },
  {
    "id": "ccbaga",
    "file": "04-ccbaga-post.jpg",
    "caption": "X 原帖：CCBaga 作者介绍工具",
    "note": "真实截图；作者宣传语不代表防封效果已证实。",
    "source": "https://x.com/chunxiangai/status/2109317576123904386"
  },
  {
    "id": "windows-recovery",
    "file": "08-windows-proxy-off.png",
    "caption": "Windows：代理客户端退出后，检查残留的手动代理",
    "note": "官方 FAQ 真实截图，红框标出开关及保存位置。故障恢复步骤是关闭该开关；图片显示的是原先开启的状态。",
    "source": "https://www.clashverge.dev/faq/windows.html"
  },
  {
    "id": "official",
    "file": "01-official-reasons.jpg",
    "caption": "官方帮助中心：列出的账号封禁原因",
    "note": "真实页面短段落节选。账号限制应按官方流程复核。",
    "source": "https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals"
  }
];
