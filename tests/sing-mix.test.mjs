import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/BehindRose.Core/Profiles/sing-mix.js', import.meta.url), 'utf8');
function apply(input) {
  const context = vm.createContext({ input: structuredClone(input) });
  return JSON.parse(JSON.stringify(vm.runInContext(source + '\nmain(input)', context, { timeout: 1000 })));
}
const node = name => ({ name, type: 'vless', server: '127.0.0.1', port: 443, uuid: '00000000-0000-4000-8000-000000000001', tls: true, 'skip-cert-verify': true });
const fixture = {
  proxies: [node('JP 01'), node('🇭🇰 HK 02')],
  'proxy-groups': [{ name: 'Old', type: 'select', proxies: ['DIRECT'] }],
  rules: ['DOMAIN,home.example,DIRECT', 'RULE-SET,local,DIRECT', 'MATCH,DIRECT'],
  'rule-providers': { local: { type: 'inline', behavior: 'domain', payload: ['home.example'] }, discarded: { type: 'inline', behavior: 'domain', payload: ['discarded.example'] } },
  dns: { nameserver: ['system'], fallback: ['223.5.5.5'], 'prefer-h3': true,
    'fake-ip-filter-mode': 'whitelist', 'fake-ip-filter': ['+.ipleak.net'],
    'nameserver-policy': { 'geosite:gfw': ['223.5.5.5'], '+.ipleak.net': 'system' } },
  profile: { 'store-fake-ip': true },
};
const result = apply(fixture);
assert.deepEqual(result.proxies, fixture.proxies, 'Preserve node credentials and transport');
assert.equal(result.mode, 'rule'); assert.equal(result.ipv6, false);
assert.deepEqual(result.dns.nameserver, ['https://1.1.1.1/dns-query#全部', 'https://8.8.8.8/dns-query#全部']);
assert.deepEqual(result.dns['proxy-server-nameserver'], ['223.5.5.5#DIRECT', '119.29.29.29#DIRECT'], 'Endpoint bootstrap cannot depend on its proxy');
assert.equal(result.dns['prefer-h3'], false); assert.equal(result.dns['respect-rules'], true);
assert.equal(result.dns['fake-ip-filter-mode'], 'blacklist'); assert.ok(!result.dns['fake-ip-filter'].includes('+.ipleak.net'));
assert.equal(result.dns.fallback, undefined); assert.equal(result.dns['nameserver-policy']['geosite:gfw'], undefined);
assert.deepEqual(result.dns['nameserver-policy']['+.ipleak.net'], result.dns.nameserver, 'Privacy probes override inherited direct DNS policies');
assert.equal(result.profile['store-fake-ip'], false);
for (const site of ['openai', 'anthropic', 'google-gemini', 'xai']) {
  assert.ok(result.rules.includes(`GEOSITE,${site},AI`));
  assert.deepEqual(result.dns['nameserver-policy'][`geosite:${site}`], ['https://1.1.1.1/dns-query#AI', 'https://8.8.8.8/dns-query#AI']);
}
assert.equal(result.rules.at(-1), 'MATCH,全部'); assert.ok(!result.rules.includes('MATCH,DIRECT'));
assert.ok(result.rules.includes('DOMAIN,home.example,DIRECT')); assert.ok(result.rules.includes('RULE-SET,local,DIRECT'));
assert.deepEqual(Object.keys(result['rule-providers']), ['local']);
const groups = result['proxy-groups'];
assert.ok(!groups.find(group => group.name === 'AI').proxies.includes('🇭🇰 HK 02'));
assert.equal(groups.find(group => group.name === 'BetterFB - AI').tolerance, 3000);
const allNames = new Set([...result.proxies.map(n => n.name), ...groups.map(g => g.name), 'DIRECT', 'REJECT']);
assert.equal(allNames.size, result.proxies.length + groups.length + 2, 'No recursive group/node naming collisions');
for (const group of groups) for (const name of group.proxies || []) assert.ok(allNames.has(name));
assert.deepEqual(apply(result), result, 'Reapplying generates identical configuration');
for (const proxies of [[node('HK')], [node('全部'), node('AI'), node('GLOBAL 2')]]) {
  const output = apply({ proxies }); assert.ok(output['proxy-groups'].every(group => group.proxies?.length || group.use?.length));
}
assert.throws(() => apply({ proxies: [node('same'), node('same')] }), /节点/);
assert.throws(() => apply({ proxies: [{ name: 'direct', type: 'direct' }] }), /没有可用/);
for (const proxies of [[], [node('US')]]) {
  const output = apply({ proxies, 'proxy-providers': { subscription: { type: 'file', path: './nodes.yaml' } } });
  assert.equal(output['proxy-providers'].subscription.path, './nodes.yaml');
  for (const group of output['proxy-groups'].filter(g => g.type === 'url-test')) assert.deepEqual(group.use, ['subscription']);
}
const out = new URL('../artifacts/sing-mix-validation/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('fixture.json', out), JSON.stringify(result, null, 2));
console.log('PASS: sing-mix DNS isolation, AI routes, node bootstrap, providers, safe direct exceptions, collisions, idempotence and generated Mihomo fixture');
