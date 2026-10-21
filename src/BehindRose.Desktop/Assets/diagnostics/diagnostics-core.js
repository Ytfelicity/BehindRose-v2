/* Local presentation/validation utilities. No network requests or persistence. */
'use strict';
const roseFlagCodes = new Set(window.RoseFlagCodes || []);
const roseRegionNames = new Map();
let roseChineseRegions;
try {
  roseChineseRegions = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  const english = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of roseFlagCodes) {
    roseRegionNames.set(english.of(code).toLowerCase(), code);
    roseRegionNames.set(roseChineseRegions.of(code).toLowerCase(), code);
  }
} catch (_) { /* Country text remains usable if Intl.DisplayNames is unavailable. */ }
for (const [name, code] of Object.entries({ 'united states of america': 'US', 'usa': 'US', 'uk': 'GB', 'russian federation': 'RU', 'korea, republic of': 'KR', 'republic of korea': 'KR', 'hong kong': 'HK', 'macao': 'MO', 'taiwan': 'TW' })) roseRegionNames.set(name, code);
window.RoseCheck = Object.freeze({
  country(code, name = '') {
    const rawCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const rawName = window.RoseCheck.text(name || code).trim();
    const resolved = roseFlagCodes.has(rawCode) ? rawCode : roseRegionNames.get(rawName.toLowerCase()) || '';
    return { code: roseFlagCodes.has(resolved) ? resolved : '', name: resolved && roseChineseRegions ? roseChineseRegions.of(resolved) : rawName || '地区未提供' };
  },
  network(value) {
    const text = window.RoseCheck.text(value);
    const match = /^(AS\d+)\s*(.*)$/i.exec(text);
    const id = match ? match[1].toUpperCase() : '';
    let name = (match ? match[2] : text) || '网络归属未提供';
    if (/cloudflare/i.test(name)) name = 'Cloudflare';
    else if (/google/i.test(name)) name = 'Google';
    else if (/amazon/i.test(name)) name = 'Amazon';
    return { id, name };
  },
  groupDns(rows) {
    const groups = new Map();
    for (const row of rows) {
      const country = window.RoseCheck.country(row.countryCode, row.country);
      const network = window.RoseCheck.network(row.asn);
      const key = (country.code || country.name) + '|' + (network.id || network.name);
      if (!groups.has(key)) groups.set(key, { key, country, network, rows: [] });
      groups.get(key).rows.push(row);
    }
    return Array.from(groups.values()).sort((a, b) => b.rows.length - a.rows.length || a.network.name.localeCompare(b.network.name));
  },
  requestPolicy(mode = 'cors') {
    if (mode !== 'cors' && mode !== 'no-cors') throw new Error('不支持的请求模式');
    // Fetch rejects cross-origin no-cors requests before networking unless redirects use follow.
    // Both hosts keep a fixed connect-src allowlist, including for any redirect target.
    return { mode, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: mode === 'no-cors' ? 'follow' : 'error' };
  },
  dnsEntries(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value.error === 'string') {
      if (/no dns servers found/i.test(value.error)) throw new Error('DNS 服务尚未记录到本次解析器，请稍后重试');
      throw new Error('DNS 服务返回：' + window.RoseCheck.text(value.error));
    }
    throw new Error('DNS 服务响应格式不匹配');
  },
  ip(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const text = value.trim().toLowerCase();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) {
      const parts = text.split('.').map(Number);
      return parts.every(n => n >= 0 && n <= 255) ? { address: parts.join('.'), family: 4 } : null;
    }
    if (!text.includes(':') || !/^[0-9a-f:.]+$/.test(text)) return null;
    try {
      const host = new URL('https://[' + text + ']/').hostname;
      return { address: host.replace(/^\[|\]$/g, ''), family: 6 };
    } catch (_) { return null; }
  },
  text(value, length = 180) { return typeof value === 'string' ? value.slice(0, length).replace(/[\u0000-\u001f\u007f]/g, ' ') : ''; },
  failure(error, stopped) {
    if (stopped) return '已停止，未完成检测';
    if (error && error.name === 'AbortError') return '请求超时，无法取得结果';
    if (error instanceof TypeError) return '服务不可达、网络受限或跨域请求被拒绝';
    return error && typeof error.message === 'string' ? error.message.slice(0, 180) : '检测未完成';
  },
  compare(candidate, baselines) {
    const peer = window.RoseCheck.ip(candidate);
    if (!peer) return { text: '地址无法解析', tone: 'warning' };
    const sameFamily = baselines.map(v => window.RoseCheck.ip(v)).filter(v => v && v.family === peer.family);
    if (!sameFamily.length) return { text: '缺少同协议 IP 基准，无法对照', tone: 'neutral' };
    if (sameFamily.some(v => v.address === peer.address)) return { text: '与本次同协议 IP 采样一致', tone: 'ok' };
    return { text: '与 IP 采样出口不同，请核对分流', tone: 'warning' };
  }
});
