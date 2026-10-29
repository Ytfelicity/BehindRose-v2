// Incremental DNS protection. Runs after the user's original profile script.
function main(config) {
  if (typeof behindRoseOriginalMain === 'function') config = behindRoseOriginalMain(config);
  if (!config || typeof config !== 'object') throw new Error('DNS 防护：原脚本未返回有效配置');
  const nodes = Array.isArray(config.proxies) ? config.proxies : [];
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const oldRules = Array.isArray(config.rules) ? config.rules : [];
  const isProxy = (name, visited = new Set()) => {
    if (!name || visited.has(name) || ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'].includes(name)) return false;
    const node = nodes.find(item => item.name === name);
    if (node) return !/^(direct|reject|dns|pass|compatible)$/i.test(node.type || '');
    const group = groups.find(item => item.name === name);
    if (!group) return false;
    const next = new Set(visited); next.add(name);
    return (group.use || []).some(provider => config['proxy-providers']?.[provider])
      || (group.proxies || []).some(member => isProxy(member, next));
  };
  const final = oldRules.find(rule => typeof rule === 'string' && /^MATCH,/i.test(rule));
  const proxy = final?.split(',')[1];
  if (!isProxy(proxy)) throw new Error('DNS 防护：无法从现有 MATCH 规则确定代理出口，请先在 Clash 设置默认代理分流');
  const dns = config.dns && typeof config.dns === 'object' ? config.dns : {};
  const remote = name => ['https://1.1.1.1/dns-query#' + name, 'https://8.8.8.8/dns-query#' + name];
  const domestic = ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'];
  const policy = { ...(dns['nameserver-policy'] || {}) };
  const add = [];
  for (const site of ['browserleaks.com', 'browserleaks.org', 'ipleak.net', 'ip.skk.moe', 'dnsleaktest.com', 'whoer.net']) {
    const existing = oldRules.find(rule => typeof rule === 'string' && rule.startsWith('DOMAIN-SUFFIX,' + site + ','));
    const target = isProxy(existing?.split(',')[2]) ? existing.split(',')[2] : proxy;
    const rule = 'DOMAIN-SUFFIX,' + site + ',' + target;
    if (!oldRules.includes(rule)) add.push(rule);
    policy['+.' + site] = remote(target);
  }
  const login = [
    ['DOMAIN-SUFFIX', 'mkey.163.com'], ['DOMAIN', 'mpay-oauth.h5.163.com'],
    ['DOMAIN', 'dl.reg.163.com'], ['DOMAIN', 'webzj.netstatic.net'],
    ['DOMAIN-SUFFIX', 'nosdn.127.net'], ['DOMAIN-SUFFIX', 'battlenet.com.cn'],
    ['DOMAIN-SUFFIX', 'blzstatic.cn'], ['DOMAIN-SUFFIX', 'dun.163.com'],
    ['DOMAIN-SUFFIX', 'dun.163yun.com'], ['DOMAIN', 'cstaticdun.126.net'], ['DOMAIN-SUFFIX', 'arkose.com.cn'],
  ];
  for (const [kind, site] of login) {
    const rule = kind + ',' + site + ',DIRECT';
    if (!oldRules.includes(rule)) add.push(rule);
    policy[(kind === 'DOMAIN-SUFFIX' ? '+.' : '') + site] = domestic;
  }
  if (!oldRules.some(rule => typeof rule === 'string' && /^GEOSITE,category-ads-all,/.test(rule)))
    add.push('GEOSITE,category-ads-all,REJECT');
  config.rules = [...add, ...oldRules];
  for (const key of Object.keys(policy))
    if (/^geosite:.*(?:gfw|!cn|openai|anthropic|gemini|xai)/i.test(key)) policy[key] = remote(proxy);
  if (!policy['geosite:cn,private']) policy['geosite:cn,private'] = domestic;
  config.dns = { ...dns, enable: true, ipv6: false, 'prefer-h3': false,
    'enhanced-mode': 'fake-ip', 'fake-ip-range': dns['fake-ip-range'] || '198.18.0.1/16',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': dns['fake-ip-filter-mode'] === 'blacklist' && Array.isArray(dns['fake-ip-filter'])
      ? dns['fake-ip-filter'] : ['*.lan', '*.local', '*.arpa', 'time.*.com', 'ntp.*.com', '*.msftncsi.com', 'www.msftconnecttest.com'],
    'default-nameserver': dns['default-nameserver'] || ['119.29.29.29', '223.5.5.5'],
    'proxy-server-nameserver': ['119.29.29.29', '223.5.5.5'],
    'direct-nameserver': dns['direct-nameserver'] || domestic,
    'direct-nameserver-follow-policy': true, nameserver: remote(proxy), 'nameserver-policy': policy };
  delete config.dns.fallback;
  delete config.dns['fallback-filter'];
  return config;
}
