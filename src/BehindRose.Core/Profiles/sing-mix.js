// BehindRose sing-mix profile v2
// Local implementation of the DNS/routing design described by Sakyvo/sing-mix.
// See docs/sing-mix配置对照.md for provenance and deliberate differences.
function main(config) {
  if (!config || typeof config !== 'object') throw new Error('sing-mix：输入配置无效');
  const nodes = Array.isArray(config.proxies) ? config.proxies : [];
  const providers = config['proxy-providers'] || {};
  const providerNames = Object.keys(providers);
  const reserved = new Set(['DIRECT', 'REJECT', 'GLOBAL']);
  // Keep every transport field and provider. Reject ambiguous references rather
  // than silently renaming a node used by dialer-proxy or a relay.
  for (const node of nodes) {
    if (!node || typeof node.name !== 'string' || reserved.has(node.name))
      throw new Error('sing-mix：节点名称缺失、重复或使用了内置名称，请先检查订阅');
    reserved.add(node.name);
  }
  const usable = nodes.filter(node => !/^(direct|reject|dns|compatible|pass)$/i.test(node.type || ''));
  if (!usable.length && !providerNames.length) throw new Error('sing-mix：订阅没有可用代理节点');
  const hk = /香港|🇭🇰|\bHK\b|\bHKG\b|HONG\s*KONG/i;
  const names = usable.map(node => node.name);
  const aiNames = names.filter(name => !hk.test(name));
  const unique = base => {
    let name = base, count = 2;
    while (reserved.has(name)) name = base + ' ' + count++;
    reserved.add(name); return name;
  };
  const all = unique('全部'), ai = unique('AI');
  const groups = [];
  const addPools = (label, selected, exclude) => {
    const auto = unique('URL Test - ' + label), stable = unique('BetterFB - ' + label);
    // A providers-only subscription can change on update. Keep a working pool
    // even when all nodes are in HK; users can select a supported AI region.
    const pool = { ...(selected.length ? { proxies: selected } : {}),
      ...(providerNames.length ? { use: providerNames } : {}) };
    if (exclude && providerNames.length && selected.length) pool['exclude-filter'] = '香港|🇭🇰|(?i:HK|HKG|HONG.?KONG)';
    for (const [name, tolerance] of [[auto, 50], [stable, 3000]])
      groups.push({ name, type: 'url-test', ...pool, url: 'https://www.gstatic.com/generate_204',
        interval: 900, tolerance, lazy: true, timeout: 3000, 'max-failed-times': 1 });
    return [stable, auto, ...selected];
  };
  const allPool = addPools(all, names, false);
  const aiPool = addPools(ai, aiNames.length ? aiNames : names, aiNames.length > 0);
  groups.push({ name: all, type: 'select', proxies: allPool }, { name: ai, type: 'select', proxies: aiPool });
  groups.push({ name: 'GLOBAL', type: 'select', proxies: [all, ai] });
  config['proxy-groups'] = groups;

  // Preserve useful explicit direct exceptions. A catch-all DIRECT rule would
  // bypass the new MATCH, while SUB-RULE may reference discarded policy groups.
  const oldRules = Array.isArray(config.rules) ? config.rules : [];
  const direct = oldRules.filter(rule => typeof rule === 'string'
    && /^(DOMAIN(?:-SUFFIX|-KEYWORD|-REGEX)?|IP-CIDR6?|SRC-IP-CIDR|GEOIP|GEOSITE|RULE-SET|PROCESS-NAME|PROCESS-PATH),/i.test(rule)
    && /,DIRECT(?:,no-resolve)?$/i.test(rule));
  const aiSites = ['openai', 'anthropic', 'google-gemini', 'xai'];
  // Keep privacy checks ahead of broad GeoSite/CN and inherited direct rules.
  // A site classified as domestic must still use the selected proxy for both
  // its connection and DNS, including subdomains used by resolver probes.
  const privacySites = ['browserleaks.com', 'browserleaks.org', 'ipleak.net',
    'ip.skk.moe', 'dnsleaktest.com', 'whoer.net'];
  const loginSites = [
    ['DOMAIN-SUFFIX', 'mkey.163.com'], ['DOMAIN', 'mpay-oauth.h5.163.com'],
    ['DOMAIN', 'dl.reg.163.com'], ['DOMAIN', 'webzj.netstatic.net'],
    ['DOMAIN-SUFFIX', 'nosdn.127.net'], ['DOMAIN-SUFFIX', 'battlenet.com.cn'],
    ['DOMAIN-SUFFIX', 'blzstatic.cn'], ['DOMAIN-SUFFIX', 'dun.163.com'],
    ['DOMAIN-SUFFIX', 'dun.163yun.com'], ['DOMAIN', 'cstaticdun.126.net'],
    ['DOMAIN-SUFFIX', 'arkose.com.cn'],
  ];
  config.rules = [...new Set([
    ...privacySites.map(site => 'DOMAIN-SUFFIX,' + site + ',' + all),
    ...loginSites.map(([kind, site]) => kind + ',' + site + ',DIRECT'),
    'GEOSITE,category-ads-all,REJECT', 'GEOSITE,private,DIRECT', 'GEOIP,private,DIRECT,no-resolve',
    ...aiSites.map(site => 'GEOSITE,' + site + ',' + ai),
    'GEOSITE,google-cn,DIRECT', 'GEOSITE,synology,DIRECT', 'DOMAIN-SUFFIX,sharepoint.com,DIRECT',
    'GEOSITE,gfw,' + all, 'GEOSITE,cn,DIRECT', 'GEOIP,CN,DIRECT,no-resolve', ...direct, 'MATCH,' + all
  ])];
  // Retain only rule providers referenced by retained direct exceptions.
  const usedProviders = new Set(direct.filter(rule => /^RULE-SET,/i.test(rule)).map(rule => rule.split(',')[1]));
  const rules = config['rule-providers'] || {};
  config['rule-providers'] = Object.fromEntries(Object.entries(rules).filter(([name]) => usedProviders.has(name)));

  const remote = group => ['https://1.1.1.1/dns-query#' + group, 'https://8.8.8.8/dns-query#' + group];
  const domestic = ['223.5.5.5#DIRECT', '119.29.29.29#DIRECT'];
  const policy = { 'geosite:private': 'system', 'geosite:cn': domestic,
    'geosite:google-cn': domestic, 'geosite:synology': domestic };
  for (const site of aiSites) policy['geosite:' + site] = remote(ai);
  for (const site of privacySites) policy['+.' + site] = remote(all);
  for (const [kind, site] of loginSites) policy[(kind === 'DOMAIN-SUFFIX' ? '+.' : '') + site] = domestic;
  // Rebuild the DNS mapping: inherited whitelist/fallback/policies can leak
  // even when nameserver is replaced. IP-literal DoH and direct node bootstrap
  // keep resolving the proxy endpoint independent of that same proxy.
  config.dns = {
    enable: true, listen: '127.0.0.1:1053', ipv6: false, 'prefer-h3': false,
    'cache-algorithm': 'arc', 'use-hosts': true, 'use-system-hosts': true,
    'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': ['geosite:private', 'geosite:cn', 'geosite:google-cn', 'geosite:synology',
      '*.lan', '*.local', '*.arpa', 'time.*.com', 'ntp.*.com', '+.market.xiaomi.com',
      'localhost.ptlogin2.qq.com', '*.msftncsi.com', 'www.msftconnecttest.com'],
    'respect-rules': true, 'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    'nameserver-policy': policy, nameserver: remote(all),
    'proxy-server-nameserver': domestic, 'direct-nameserver': domestic,
    'direct-nameserver-follow-policy': true
  };
  config.profile = { ...(config.profile || {}), 'store-selected': true, 'store-fake-ip': false };
  config.tun = { ...(config.tun || {}), enable: true, stack: 'system',
    'auto-route': true, 'auto-detect-interface': true, 'strict-route': true,
    'dns-hijack': ['any:53', 'tcp://any:53'] };
  config.sniffer = { enable: true, 'force-dns-mapping': true, 'parse-pure-ip': true,
    'override-destination': true, sniff: { HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
      TLS: { ports: [443, 8443] }, QUIC: { ports: [443, 8443] } } };
  config['geodata-mode'] = true;
  config['geo-auto-update'] = true;
  config['geo-update-interval'] = 24;
  config['geox-url'] = { ...(config['geox-url'] || {}),
    geoip: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat',
    geosite: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat' };
  config.mode = 'rule'; config.ipv6 = false;
  return config;
}
