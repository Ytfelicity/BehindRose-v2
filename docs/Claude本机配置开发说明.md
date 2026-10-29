# Claude Code 文章手册与本地操作

主入口为 `claude-handbook.tsx`，展示已保存文章的 13 节原文、21 段命令和 8 张真实配图；来源及逐节映射见 [功能对照](Claude文章功能对照.md)。内容和脚本均作为数据展示、复制或下载，不执行文章命令。进入页面没有配置检查或联网副作用。

本地操作独立于网络防护修复和网络诊断。手册只暴露主动读取 Claude 摘要、恢复此前工具箱设置备份，以及可选的台北时区操作。原配置规划服务保留兼容性，手册以 `recoveryOnly` 挂载旧界面，不能从主流程创建永久代理设置。LocalApp 保留完整预览和十分钟有效的单次执行编号，前端只收到脱敏显示数据。

## Claude 设置服务边界

- 不调用 HttpClient、Socket、Clash 控制器或进程启动接口，不读取登录凭据文件。
- 只修改当前用户或 CLAUDE_CONFIG_DIR 下的 settings.json。候选端口从本机 Clash 配置读取，不探测端口或检测节点。
- 保留模式不改服务地址、令牌、模型、插件或权限；官方模式只移除明确列入预览的接入覆盖。外部环境和组织限制存在冲突时停止。
- 预览和状态不展示配置值、端点或密钥；完整修改前后快照仅保存在服务内部及当前 Windows 用户的 DPAPI 加密备份中。
- 应用前比较原文件、核验加密备份，再原子写入并复读确认。恢复时拒绝覆盖后续修改，恢复本身也有备份。
- 演示服务使用独立临时目录和假数据，不读真实用户配置。测试通过 stdio 调用演示接口，不启动 HTTP 服务或桌面应用。

## 可选时区边界

文章第 03、11 节的台北时区为未证实防封效果的个人经验，默认不勾选。用户选择后才可预览，再单独确认应用。生产适配器仅在应用或恢复时调用固定系统目录中的 `tzutil.exe`，使用 `ArgumentList`、隐藏窗口且不经过 Shell。它不会修改 UTC 系统时钟、自动时区、定位、自动校时、DNS、Clash 或 Claude；整机本地时间显示及依赖本地时间的计划任务会受影响。

服务保留原时区和夏令时标记；先保存当前 Windows 用户可解密的 DPAPI 备份，再执行和核验。过期方案、后续变化、损坏或未完成记录会阻止覆盖。时区与设置服务使用各自的预览编号和备份目录。`CreateDemo()` 使用独立临时目录、虚拟 UTC/台北状态和临时密钥，不读取 Windows 实际时区。测试只注入假状态，不调用生产读取器或 setter。

## 文章资源

`scripts/import-claude-handbook.mjs <本地原文章文件夹>` 仅从磁盘导入已写好的手册，保存可追溯来源快照、原图和原始脚本。它不联网，也不执行脚本。完整图文页、配图和下载包随工作台嵌入程序集，路由限定已知资源；完整文章仅额外允许数据图片，样式及界面脚本均使用本地文件。桌面下载仅放行这三个本地脚本、手册 ZIP 和 Markdown；图文原文与八张原图仅允许从当前工作台来源打开。点击下载只保存文件，不运行 PowerShell。

## 仅离线验证

依赖已安装时使用 --no-restore 构建，不调用项目的联网安装或诊断脚本。建议关闭 .NET 遥测与工作负载更新通知。

```powershell
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
$env:DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE = 'true'
dotnet build BehindRose.slnx --no-restore -c Release -p:NuGetAudit=false
dotnet tests/BehindRose.Tests/bin/Release/net10.0-windows/BehindRose.Tests.dll --claude-offline
dotnet tests/BehindRose.Tests/bin/Release/net10.0-windows/BehindRose.Tests.dll --claude-timezone-offline
dotnet tests/BehindRose.Tests/bin/Release/net10.0-windows/BehindRose.Tests.dll --claude-handbook-offline
node tests/claude-workbench.test.mjs
```

前端在 frontend 目录运行：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node tests/claude-setup.test.mjs
node tests/claude-handbook-content.test.mjs
node tests/claude-handbook.test.mjs
node build.mjs
```

离线选择器只执行临时文件、假状态、内存密码学和静态资源路径测试，不运行原有的代理、Socket、更新或真实机器检查。前端测试使用 mock fetch 和静态 React 渲染；内容测试逐字核对原文和代码块。stdio 演示测试核对设置和时区完整预览、应用、恢复、隔离和参数拒绝流程。没有调用用户真实配置或时区的应用、恢复操作。

本次验证不包含真实网络、账号登录、模型请求或正在运行的桌面程序。配置保存成功只证明本地文件写入及核对成功。
