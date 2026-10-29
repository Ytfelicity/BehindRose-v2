import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/BehindRose.Core/Profiles/dns-protection.js', import.meta.url), 'utf8');
const apply = input => {
  const context = vm.createContext({ input: structuredClone(input) });
  return JSON.parse(JSON.stringify(vm.runInContext(source + '\nmain(input)', context, { timeout: 1000 })));
};
const fixture = {
  proxies: [{ name: 'My node', type: 'vless', server: '127.0.0.1', port: 443 }],
  'proxy-groups': [{ name: 'My exit', type: 'select', proxies: ['My node'] }, { name: 'Ads', type: 'select', proxies: ['REJECT', 'DIRECT'] }],
  'proxy-providers': { mine: { type: 'file', path: './mine.yaml' } },
  'rule-providers': { mine: { type: 'inline', behavior: 'domain', payload: ['office.example'] } },
  rules: ['DOMAIN,office.example,DIRECT', 'RULE-SET,mine,DIRECT', 'GEOSITE,category-ads-all,Ads', 'MATCH,My exit'],
  tun: { stack: 'mixed', mtu: 1400 }, profile: { 'store-selected': true },
  dns: { listen: '0.0.0.0:53', 'nameserver-policy': { '+.office.example': '192.168.1.1', 'geosite:gfw': 'system' }, fallback: ['system'] },
};
const result = apply(fixture);
for (const key of ['proxies', 'proxy-groups', 'proxy-providers', 'rule-providers', 'tun', 'profile'])
  assert.deepEqual(result[key], fixture[key], 'Keep original ' + key);
assert.deepEqual(result.rules.slice(-fixture.rules.length), fixture.rules, 'Every existing rule retains its order and destination');
assert.deepEqual(result.dns.nameserver, ['https://1.1.1.1/dns-query#My exit', 'https://8.8.8.8/dns-query#My exit']);
assert.equal(result.dns['nameserver-policy']['+.office.example'], '192.168.1.1', 'Keep private split DNS');
for (const domain of ['browserleaks.com','browserleaks.org','ipleak.net','ip.skk.moe','dnsleaktest.com','whoer.net']) {
  assert.ok(result.rules.includes('DOMAIN-SUFFIX,' + domain + ',My exit'));
  assert.deepEqual(result.dns['nameserver-policy']['+.' + domain], result.dns.nameserver);
}
assert.deepEqual(result.dns['nameserver-policy']['geosite:gfw'], result.dns.nameserver);
assert.equal(result.dns.fallback, undefined);
assert.ok(result.rules.includes('DOMAIN-SUFFIX,battlenet.com.cn,DIRECT'));
assert.deepEqual(apply(result), result, 'Repeated configuration never accumulates rules or changes proxy groups');
assert.throws(() => apply({ ...fixture, rules: ['MATCH,DIRECT'] }), /默认代理分流/);
assert.throws(() => apply({ ...fixture, rules: ['MATCH,missing'] }), /默认代理分流/);
const alternative = apply({ ...fixture, rules: ['DOMAIN-SUFFIX,browserleaks.com,My node', ...fixture.rules] });
assert.deepEqual(alternative.dns['nameserver-policy']['+.browserleaks.com'], ['https://1.1.1.1/dns-query#My node', 'https://8.8.8.8/dns-query#My node'], 'Retain an existing dedicated privacy route');
const context = vm.createContext({ input: structuredClone(fixture), behindRoseOriginalMain(config) { config.customOriginalRan = true; return config; } });
assert.equal(vm.runInContext(source + '\nmain(input)', context).customOriginalRan, true, 'Execute the original profile script first');
console.log('PASS: use existing proxy groups, preserve nodes/rules/providers/stack and private DNS, original script chaining, privacy routes, ambiguous exit refusal and idempotence');
