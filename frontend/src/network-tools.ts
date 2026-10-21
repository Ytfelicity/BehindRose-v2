export const networkTools = [
  { id: 'ip-quality', label: 'IP 质量', target: '所选网络访问 IPPure 的出口', duration: '单次查询 · 最长 20 秒', requirement: '无需 Docker，使用现有网络即可', description: '使用 IPPure 查看 IP 归属、风险系数和类型。' },
  { id: 'browser-network', label: '浏览器网络', target: '当前浏览器', duration: 'DNS 连续采样 · 可随时停止', requirement: '无需填写连接信息', description: '查看公网 IP、DNS 解析来源和 WebRTC 出口。' },
  { id: 'connectivity', label: '网站连通性', target: '当前浏览器访问的网站', duration: '快速检测最多 5 秒', requirement: '选择网站分组即可', description: '检查网站能否响应，比较真实 HTTPS 请求耗时。' },
] as const;
export type NetworkTool = typeof networkTools[number]['id'];

// Keep guide metadata for the retired source modules outside active navigation.
export const detectionTools = [
  ...networkTools,
  { id: 'proxy-network', label: '代理网络', target: '填写端口对应的本机 HTTP 代理', duration: '最长 5 分钟', requirement: '需要一个可连接的 HTTP 代理端口', description: '检查指定代理的出口、三网连接和下载上传表现。' },
] as const;
export type DetectionTool = typeof detectionTools[number]['id'];
export function networkToolFromHash(hash: string): NetworkTool {
  const id = hash.replace(/^#/, '');
  return networkTools.find(tool => tool.id === id)?.id ?? 'ip-quality';
}
