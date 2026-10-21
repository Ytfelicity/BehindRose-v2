# MyIP 检测接入

源码固定为 `jason5ng32/MyIP@a185d1844d28e7535ea3ec5c0277280a77435609`，遵循 MIT 许可并保留作者版权。原文件保存在 `vendor/MyIP/`，生成器逐字提取检测函数，来源及生成内容的 SHA-256 随模块记录。

## 普通 DNS 检测

此节记录原 MyIP DNS 接入。当前界面已改用 dnsleaktest.com，详见 [DNSLeakTest 接入](DNSLeakTest接入.md)；保留的 MyIP DNS 源码和测试不参与当前采样。

以下普通 DNS 重试、六秒等待等段落是历史实现记录，不是当前 DNS 采样行为。当前连通性、WebRTC、公网 IP 及地区库逐项核对见 [2026-10-17 检测源码对齐](2026-10-17-检测源码对齐.md)。

默认四个采样项：ip-api.com、surfsharkdns.com、dns.myipstack.com、fastly.com。失败后按上游顺序尝试 bash.ws、browserleaks、ipleak 和其它采样项的服务。同一轮共享各服务的两次尝试预算；每次生成新子域，四项错峰 200 ms。

每个服务返回一个代表解析器地址，不能据此列出全部系统解析器。卡片显示实际回答的服务以及回退来源，地址去重后按地区汇总。四个采样项可能共用同一个备用服务，所以数量分别说明采样项、实际服务和代表地址。

上游请求函数的五秒计时覆盖取得响应头；响应正文仍受整轮取消信号控制。宿主等待实际结束，不采用上游六秒提前报表造成的后台残留。IP、DNS 和 WebRTC 并行完成后才启动网站检测，避免大量 favicon 请求挤占核心采样资源；两个阶段分别最多 55 秒，停止或第一阶段超时后不再启动网站检测。停止会取消等待及请求；有效的已取得地址可以保留，状态标为采样不完整。

## WebRTC

官方来源与顺序为 Google (`stun.l.google.com:19302`)、BlackBerry (`stun.voip.blackberry.com:3478`)、Twilio (`global.stun.twilio.com`)、Cloudflare (`stun.cloudflare.com`)。四项并行，每源最长五秒，取得第一个 srflx/prflx 映射候选后结束。停止、失败和超时都会关闭 PeerConnection 并清理计时器。

保留候选类型，不能据此把设备判为对称或 Full Cone NAT。不请求摄像头或麦克风。普通复制报告包含来源、出口地址、候选类型及对照结论，不包含完整 SDP 和临时 ICE 凭据。

## 归属与边界

国家和地区仍使用随包 DB-IP 本地库。未调用上游在线 MaxMind 后端，未查询到的机构和 ASN 保持未知。单个代表出口、地址不一致或超时都不是全局安全结论。

此次接入普通 DNS 和 WebRTC，不启用另一个需要 Firebase 用户 Token、服务端 API Key 和额度的增强 DNS 服务。检测保留点击后才采样的现有流程，不自动上传遥测，不修改 Windows DNS、Clash、浏览器策略或路由。

## 验证

- `npm run check`、`npm run build` 验证类型与打包。
- `npm run test:myip-diagnostics` 验证原源码一致性、七个来源的请求及解析、共享重试和回退、五秒超时、取消、四个官方 STUN 配置、首候选和连接关闭。
- `npm test` 验证页面展示、代表地址去重、报告、失败保持未知、停止及迟到响应隔离、八项状态和手机布局。
- 这些自动化检查使用模拟 HTTPS 和 STUN，不将模拟结果当作实际网络通过。
