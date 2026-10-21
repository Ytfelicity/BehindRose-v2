/* BehindRose diagnostics. Local source assets, bounded status messages, no privileged bridge or automatic probes. */
'use strict';
(() => {
  const R = window.RoseCheck;
  const $ = id => document.getElementById(id);
  const providers = window.RoseMyIP.stunProviders;
  const dnsProviders = window.RoseMyIP.dnsProviders;
  const labels = { idle: '未检测', running: '检测中', ready: '已取得结果', failed: '检测失败', cancelled: '已停止', unavailable: '无法确认', skipped: '未选择' };
  const tones = { idle: 'neutral', running: 'active', ready: 'ok', failed: 'error', cancelled: 'warning', unavailable: 'warning', skipped: 'neutral' };
  const blank = () => ({ status: 'idle', address: '', note: '等待检测', geo: '未查询', onlineGeo:'unqueried', timestamp: '', country: null, city: '', network: '' });
  let ip4, ip6, dns, rtc;
  let active = null;
  let websiteRun = null;
  let hostEpoch = '';
  function tellHost(kind, epoch, statuses) { if (location.hostname === 'diagnostics.behindrose.invalid' && window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ kind, epoch, statuses }); }
  let lastTime = '';
  let lastScope = '';
  let copyFeedbackTimer;
  const countryCache = new Map(), countryTasks = new Map();
  const qualityReports = new Map();
  async function localCountry(address) {
    if (countryCache.has(address)) return countryCache.get(address);
    if (!countryTasks.has(address)) countryTasks.set(address, window.RoseCountryLookup.lookup(address).then(country => { countryCache.set(address,country); return country; }).catch(() => null).finally(() => countryTasks.delete(address)));
    return countryTasks.get(address);
  }
  async function localCountries(addresses, signal) {
    if (signal.aborted) return new Map();
    let stop;
    const cancelled = new Promise(resolve => {
      stop = () => resolve([]);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
    try {
      const rows = await Promise.race([Promise.all(addresses.map(async address => [address, await localCountry(address)])), cancelled]);
      return new Map(rows);
    } finally { signal.removeEventListener('abort', stop); }
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '/icons.svg#' + name); svg.append(use); return svg;
  }
  function flag(country) {
    if (!country || !country.code) return icon('globe');
    const image = element('img', undefined, 'country-flag');
    image.src = '/flags/' + country.code.toLowerCase() + '.svg'; image.alt = country.name + '旗帜';
    image.width = 32; image.height = 24; return image;
  }
  function badge(id, status, override) {
    $(id).replaceChildren(icon(status === 'ready' ? 'check' : ['failed', 'unavailable', 'cancelled'].includes(status) ? 'alert' : status === 'running' ? 'radar' : 'clock'), element('span', override || labels[status]));
    $(id).className = 'badge ' + tones[status];
    $(id).dataset.state = status;
  }
  function freshDns() {
    return { status: 'idle', note: '采用 IPLeak.net 连续 DNS 采样，结果实时显示，可随时停止。', rows: [], timestamp: '', sources: dnsProviders.map((p, slot) => ({ slot, sourceId: p.id, sourceName: p.name, status: 'idle', note: '等待检测' })) };
  }
  function freshRtc() {
    return providers.map(p => ({ ...p, status: 'idle', addresses: [], note: '等待检测' }));
  }
  function reset() {
    ip4 = blank(); ip6 = blank(); dns = freshDns(); rtc = freshRtc();
  }
  function now() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
  function renderIp(prefix, data) {
    const section = $(prefix + '-address').closest('.ip-card');
    section.dataset.state = data.status;
    section.dataset.geo = data.onlineGeo === 'failed' ? 'partial' : data.country ? 'known' : data.geo.startsWith('未查询') ? 'unqueried' : 'unknown';
    badge(prefix + '-status', data.status);
    $(prefix + '-address').textContent = data.address || '—';
    $(prefix + '-note').textContent = data.note;
    $(prefix + '-note').hidden = data.status === 'ready';
    $(prefix + '-copy').disabled = !data.address;
    const place = $(prefix + '-place'); place.replaceChildren();
    place.className = 'ip-place' + (data.country ? '' : ' unknown');
    if (data.country) {
      place.append(flag(data.country), element('span', data.country.name + (data.city ? ' · ' + data.city : '')));
    } else place.append(icon('globe'), element('span', data.geo === '未查询' || data.geo.startsWith('未查询') ? '地区未查询' : data.geo.includes('查询中') ? '正在查询地区' : '地区信息未取得'));
    $(prefix + '-network').textContent = data.network || (data.status === 'idle' ? '等待检测' : data.onlineGeo === 'unqueried' ? '未查询' : data.onlineGeo === 'running' ? '查询中' : '归属未取得');
    $(prefix + '-network').hidden = false;
    $(prefix + '-geo').textContent = data.status === 'idle' ? '开始检测后显示出口地址' : data.onlineGeo === 'failed' ? data.geo : data.country ? '国家 / 地区来自本地数据库，为估计值' : data.geo;
    $(prefix + '-time').textContent = data.timestamp;
  }
  function renderDns() {
    const sourceRoot = $('dns-source-list');
    if (sourceRoot) {
      sourceRoot.replaceChildren();
      dns.sources.forEach(source => {
        const card = element('div', undefined, 'dns-source');
        card.dataset.state = source.status;
        const link = element('a', source.sourceName, 'dns-source-link');
        link.href = 'https://ipleak.net/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        card.append(link, element('span', '连续采样 · 最多 300 次 · 可随时停止', 'dns-source-method'));
        if (source.status !== 'idle') card.append(element('span', (source.completedQueries || 0) + ' / ' + (source.totalQueries || 300) + ' 次请求' + (typeof source.serverCount === 'number' ? ' · ' + source.serverCount + ' 个服务器' : '') + (source.failedQueries ? ' · ' + source.failedQueries + ' 次失败' : ''), 'dns-source-progress'));
        sourceRoot.append(card);
      });
    }
    // The summary is optional so the desktop and standalone engine remain compatible.
    const summary = $('dns-overview-count');
    if (summary) {
      summary.replaceChildren(document.createTextNode(dns.rows.length ? String(dns.rows.length) : '—'), element('span', '个解析器'));
      $('dns-overview-state').textContent = dns.status === 'idle' ? '等待检测' : dns.status === 'running' ? '正在采样' : dns.rows.length ? '已取得解析来源' : dns.status === 'skipped' ? '本次未选择 DNS' : dns.status === 'cancelled' ? '采样已停止' : '未取得解析数据';
    }
    badge('dns-status', dns.status);
    $('dns-status').closest('.dns-card').dataset.state = dns.status;
    $('dns-note').textContent = dns.note;
    $('dns-note').hidden = ['idle', 'ready', 'running', 'skipped'].includes(dns.status);
    $('dns-time').textContent = dns.timestamp;
    const root = $('dns-rows'); root.replaceChildren();
    $('dns-metrics').hidden = !dns.rows.length;
    if (!dns.rows.length) {
      root.append(element('li', dns.status === 'idle' ? '点击“检测 DNS”，查看本次解析器列表。' : dns.status === 'running' ? '正在查询 DNS 解析器…' : dns.status === 'skipped' ? '本次未选择 DNS 检测。' : dns.status === 'cancelled' ? '检测已停止，尚未取得解析器记录。' : '尚未取得可确认的解析器记录。', 'dns-cards-empty'));
      renderObservation();
      return;
    }
    $('dns-count').textContent = dns.rows.length;
    $('dns-note').textContent = dns.note;
    for (const resolver of dns.rows) {
      const card = element('li', undefined, 'dns-resolver-card');
      // Change presentation only. Do not translate/enrich country data,
      // canonicalize IP strings, regroup, sort or deduplicate upstream rows.
      const hostname = String(resolver.hostname ?? '');
      const host = element('p', hostname, 'dns-result-host');
      host.title = hostname;
      const country = String(resolver.country ?? '');
      const place = [country, resolver.region].filter(Boolean).join(' - ');
      const body = element('div', undefined, 'dns-resolver-body');
      // Use the supplied code solely to select the corresponding local flag;
      // it must never replace, translate or infer the returned location text.
      if (/^[a-z]{2}$/i.test(resolver.country_code)) body.append(flag({ code: resolver.country_code, name: country }));
      const details = element('div', undefined, 'dns-resolver-details');
      details.append(element('p', place, 'dns-result-region'), element('p', String(resolver.isp ?? ''), 'dns-result-isp'));
      if (resolver.metadataStatus !== 'ready') details.append(element('p', resolver.metadataStatus === 'loading' ? '正在查询归属…' : '归属信息未取得', 'dns-result-lookup'));
      body.append(details);
      card.append(element('strong', resolver.address, 'dns-result-ip mono'), body);
      const footer = element('div', undefined, 'dns-result-footer');
      if (hostname) footer.append(host);
      if (Number.isSafeInteger(resolver.hits)) footer.append(element('span', resolver.hits + ' 次命中', 'dns-result-hits'));
      card.append(footer);
      root.append(card);
    }
    renderObservation();
  }
  function renderRtc() {
    const root = $('rtc-list'); root.replaceChildren();
    const baseline = [ip4.address, ip6.address].filter(Boolean);
    const isDifferent = row => row.addresses.some(address => R.compare(address, baseline).tone === 'warning');
    [...rtc].sort((a, b) => Number(isDifferent(b)) - Number(isDifferent(a))).forEach(row => {
      const different = isDifferent(row);
      const box = element('article', undefined, 'rtc-item' + (different ? ' different' : ''));
      box.dataset.state = row.status;
      box.append(element('strong', row.name, 'rtc-provider'));
      const compared = row.addresses.map(address => R.compare(address, baseline));
      const matched = compared.length > 0 && compared.every(x => x.tone === 'ok');
      const state = different ? '出口不同' : matched ? '与公网 IP 一致' : row.status === 'ready' ? '缺少对照基准' : labels[row.status];
      const status = element('span', undefined, 'badge ' + (different ? 'warning' : matched ? 'ok' : tones[row.status]));
      status.classList.add('rtc-comparison');
      status.append(icon(different ? 'alert' : matched ? 'check' : 'clock'), element('span', state));
      const addresses = element('div', undefined, 'rtc-addresses');
      if (!row.addresses.length) addresses.append(element('p', '—', 'rtc-address mono'));
      row.addresses.forEach(address => {
        const line = element('div', undefined, 'rtc-address-line');
        const known = [ip4, ip6].find(sample => sample.address === address && sample.country?.code)?.country || countryCache.get(address);
        if (known?.code) line.append(flag(known));
        line.append(element('p', address, 'rtc-address mono'));
        addresses.append(line);
      });
      box.append(addresses, status);
      if (different) box.append(element('p', '建议核对分流、节点或多网卡设置', 'rtc-state'));
      else if (row.status !== 'ready') box.append(element('p', row.note, 'rtc-state'));
      const detail = element('details', undefined, 'rtc-host'); detail.append(element('summary', '来源'), element('p', 'IPCheck.ing / MyIP · ' + row.host + ' · ' + row.note + (row.candidateType ? ' · 候选类型 ' + row.candidateType : ''))); box.append(detail); root.append(box);
    });
    const successes = rtc.filter(row => row.status === 'ready').length;
    const running = rtc.some(row => row.status === 'running');
    const settled = rtc.every(row => row.status !== 'running' && row.status !== 'idle');
    const overview = $('rtc-overview-count');
    const skipped = rtc.every(row => row.status === 'skipped');
    if (overview) {
      overview.textContent = skipped || !running && !settled ? '—' : String(successes);
      $('rtc-overview-state').textContent = skipped ? '本次未选择 WebRTC' : running ? '正在采样 · ' + successes + ' / ' + providers.length + ' 个来源有结果' : settled ? successes + ' / ' + providers.length + ' 个来源有结果' : '等待检测';
      overview.closest('.dashboard-metric')?.setAttribute('data-state', running ? 'running' : skipped ? 'skipped' : settled ? successes === providers.length ? 'ready' : 'unavailable' : 'idle');
    }
    if (running) badge('rtc-status', 'running', successes + ' / ' + providers.length + ' 个来源有结果');
    else if (rtc.every(row => row.status === 'skipped')) badge('rtc-status', 'skipped');
    else if (settled) badge('rtc-status', successes === providers.length ? 'ready' : 'unavailable', successes + ' / ' + providers.length + ' 个来源有结果');
    else badge('rtc-status', 'idle');
    renderObservation();
  }
  function renderObservation() {
    const baseline = [ip4.address, ip6.address].filter(Boolean);
    const different = rtc.filter(row => row.addresses.some(address => R.compare(address, baseline).tone === 'warning'));
    const incomplete = [ip4, ip6, dns, ...rtc].filter(row => ['failed', 'unavailable', 'cancelled'].includes(row.status));
    $('observation').hidden = !different.length && !incomplete.length;
    $('observation').dataset.tone = different.length ? 'warning' : 'neutral';
    $('observation-icon').replaceChildren(icon(different.length ? 'alert' : 'info'));
    $('observation-title').textContent = different.length ? different.length + ' 个 WebRTC 来源的出口不同' : incomplete.length + ' 项采样未取得完整结果';
    $('observation-note').textContent = different.length ? different.map(x => x.name).join('、') + ' 与同协议公网 IP 不一致，建议核对分流。' : '请查看对应项目；超时或无结果不能视为检测通过。';
    $('observation-link').hidden = !different.length;
  }
  function render() { renderIp('ip4', ip4); renderIp('ip6', ip6); renderDns(); renderRtc(); $('geo-retry').hidden = ![ip4,ip6].some(data => data.address && data.onlineGeo !== 'ready'); }

  // Browser fetches are deliberate: native/server-side probes would measure a different path.
  async function request(url, ctx, { timeout = 8000, mode = 'cors', json = true } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    ctx.controller.signal.addEventListener('abort', abort, { once: true });
    if (ctx.controller.signal.aborted) abort();
    const timer = setTimeout(abort, timeout);
    try {
      const response = await fetch(url, { ...R.requestPolicy(mode), signal: controller.signal });
      if (mode === 'no-cors') return null;
      if (!response.ok) throw new Error('服务返回 HTTP ' + response.status);
      const max = 262144;
      if (Number(response.headers.get('content-length')) > max) throw new Error('服务响应过大');
      if (!response.body) throw new Error('服务未返回内容');
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let text = '', size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > max) { await reader.cancel(); throw new Error('服务响应过大'); }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      if (!json) return text;
      try { return JSON.parse(text); } catch (_) { throw new Error('服务返回的内容不是有效 JSON'); }
    } finally {
      clearTimeout(timer); ctx.controller.signal.removeEventListener('abort', abort);
    }
  }

  async function probeIp(family, ctx) {
    const data = family === 4 ? ip4 : ip6;
    const url = family === 4 ? 'https://api.ipify.org?format=json' : 'https://api6.ipify.org?format=json';
    data.status = 'running'; data.note = '正在请求 ipify IPv' + family + ' 接口…'; render();
    try {
      const result = await request(url, ctx);
      const parsed = R.ip(result && result.ip);
      if (!parsed || parsed.family !== family) throw new Error('服务没有返回预期协议的有效 IP');
      data.address = parsed.address; data.status = 'ready'; data.timestamp = now();
      data.note = '本次浏览器访问 ipify 时显示的公网地址';
      data.geo = '本地国家查询中…'; render();
      const country = (await localCountries([parsed.address], ctx.controller.signal)).get(parsed.address);
      if (ctx.controller.signal.aborted) return;
      data.country = country;
      data.geo = country ? country.name + '（本地 DB-IP 国家库，估计值）' : '本地国家信息未取得';
      render();
      enrichFromQuality(data);
    } catch (error) {
      data.status = ctx.controller.signal.aborted ? 'cancelled' : 'failed';
      data.note = R.failure(error, ctx.controller.signal.aborted) + (family === 6 ? '；也可能未配置 IPv6。' : '。');
      data.timestamp = now();
    }
    render();
  }

  function enrichFromQuality(data) {
    const report=qualityReports.get(data.address), geo=report?.Source === 'IPPure' ? report.Data : null;
    if(!geo || ![geo.countryCode,geo.city,geo.asOrganization,geo.asn].some(Boolean))return;
    const country=R.country(geo.countryCode,geo.country);if(country.code)data.country=country;
    data.city=R.text(geo.city,80);
    const asn=R.text(geo.asn == null ? '' : String(geo.asn),30).replace(/^AS/i,'');
    data.network=[R.text(geo.asOrganization,160),asn?'AS'+asn:''].filter(Boolean).join(' · ');
    data.onlineGeo='ready';data.geo=[data.country?.name,data.city,data.network].filter(Boolean).join(' / ')+'（IPPure，估计值）';
  }
  window.addEventListener('quality-report',event=>{
    const report=event.detail, parsed=R.ip(report?.Head?.IP);if(!parsed||report.Source!=='IPPure'||R.ip(report.Data?.ip)?.address!==parsed.address)return;
    qualityReports.set(parsed.address,report);
    [ip4,ip6].filter(data=>data.address===parsed.address).forEach(enrichFromQuality);render();
  });

  async function probeDns(ctx) {
    dns.status = 'running'; dns.note = '正在开始 IPLeak DNS 连续采样…'; renderDns();
    try {
      const sources = await window.RoseMyIP.probeDns(ctx.controller.signal, source => {
        if (active !== ctx || ctx.controller.signal.aborted) return;
        dns.sources[source.slot] = source;
        dns.rows = (source.rows || []).map(resolver => ({ ...resolver, sources: [source.sourceName] }));
        dns.note = source.note;
        renderDns();
      });
      if (active !== ctx) return;
      dns.sources = sources;
      dns.rows = sources.flatMap(source => (source.rows || []).map(resolver => ({ ...resolver, address: resolver.ip_address, sources: [source.sourceName] })));
      const complete = sources.length === 1 && sources[0].status === 'ready';
      dns.status = ctx.controller.signal.aborted ? 'cancelled' : complete && dns.rows.length ? 'ready' : 'unavailable';
      dns.note = ctx.controller.signal.aborted ? '已停止 IPLeak 采样，保留已取得的解析器。' : (sources[0]?.note || 'IPLeak 未返回有效解析器').replace(/[。.!]+\s*$/, '') + (dns.status === 'ready' ? '。' : '。未取得完整数据不能视为无泄漏。');
      dns.timestamp = now();
    } catch (error) {
      dns.status = ctx.controller.signal.aborted ? 'cancelled' : 'unavailable';
      dns.note = R.failure(error, ctx.controller.signal.aborted) + '。这不是“无泄漏”的证据。'; dns.timestamp = now();
    }
    renderDns();
  }

  function pause(milliseconds, ctx) {
    return new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); ctx.controller.signal.removeEventListener('abort', done); resolve(); };
      ctx.controller.signal.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, milliseconds);
      if (ctx.controller.signal.aborted) done();
    });
  }

  function probeRtc(row, ctx) {
    row.status = 'running'; row.note = 'MyIP 采样：等待首个 STUN 映射候选，最长 5 秒…'; renderRtc();
    return window.RoseMyIP.probeRtc(row.host, ctx.controller.signal).then(async result => {
      if (active !== ctx) return;
      row.addresses = result.addresses.map(address => R.ip(address)?.address).filter(Boolean);
      row.status = ctx.controller.signal.aborted ? 'cancelled' : result.status === 'ready' && !row.addresses.length ? 'unavailable' : result.status;
      row.note = result.note;
      row.candidateType = result.candidateType;
      await localCountries(row.addresses, ctx.controller.signal);
      if (active === ctx) renderRtc();
    });
  }

  function toggleControls(running) {
    const busy = running || Boolean(window.RoseConnectivity?.isRunning());
    $('start').disabled = busy; $('stop').disabled = !busy; $('clear').disabled = busy;
    ['select-ip', 'select-dns', 'select-rtc', 'select-connect'].forEach(id => { $(id).disabled = busy; });
    $('copy').disabled = busy || !lastTime;
    for (const scope of ['dns', 'rtc']) {
      const button = $(scope + '-run');
      if (!button) continue;
      const stopping = running && active?.scope === scope;
      const name = scope === 'dns' ? 'DNS' : 'WebRTC';
      button.disabled = busy && !stopping;
      button.dataset.running = String(stopping);
      button.setAttribute('aria-label', stopping ? '停止 ' + name + ' 检测' : '检测 ' + name);
      $(scope + '-run-label').textContent = stopping ? '停止检测' : '检测 ' + name;
    }
  }
  function progress(ctx) {
    const percent = ctx.total ? Math.round(ctx.done / ctx.total * 100) : 0;
    $('progress-fill').style.width = percent + '%'; $('progress').setAttribute('aria-valuenow', String(percent));
    $('progress-text').textContent = ctx.done + ' / ' + ctx.total;
  }
  // Share the execution lock and native lifecycle, but keep each section's
  // visible progress and report metadata scoped to its own probes.
  window.addEventListener('connectivity-state', event => {
    if (active) { toggleControls(true); return; }
    const snapshot = window.RoseConnectivity?.snapshot();
    if (!snapshot) return;
    if (event.detail?.running && !websiteRun) {
      const ctx = { epoch: hostEpoch };
      websiteRun = ctx;
      tellHost('started', ctx.epoch);
    } else if (!event.detail?.running && websiteRun) {
      const ctx = websiteRun; websiteRun = null;
      tellHost('completed', ctx.epoch, [...Array(7).fill('skipped'), event.detail?.cancelled ? 'cancelled' : snapshot.incomplete ? 'unavailable' : 'ready']);
    }
    toggleControls(false);
  });
  async function start(scope) {
    if (active || window.RoseConnectivity?.isRunning()) return;
    const single = scope === 'dns' || scope === 'rtc';
    const selected = single ? { ip: false, dns: scope === 'dns', rtc: scope === 'rtc', connect: false } : { ip: $('select-ip').checked, dns: $('select-dns').checked, rtc: $('select-rtc').checked, connect: $('select-connect').checked };
    if (!selected.ip && !selected.dns && !selected.rtc && !selected.connect) { $('overall').textContent = '请至少选择一个检测项目'; return; }
    clearTimeout(copyFeedbackTimer); $('copy-label').textContent = '复制报告';
    if (single) {
      if (selected.dns) dns = freshDns();
      if (selected.rtc) rtc = freshRtc();
    } else {
      reset();
      if (!selected.ip) { ip4.status = ip6.status = 'skipped'; ip4.note = ip6.note = '本次未选择 IP 检测'; }
      if (!selected.dns) { dns.status = 'skipped'; dns.note = '本次未选择 DNS 检测'; }
      if (!selected.rtc) rtc.forEach(row => { row.status = 'skipped'; row.note = '本次未选择 WebRTC 检测'; });
    }
    const currentRows = [...(selected.ip ? [ip4, ip6] : []), ...(selected.dns ? [dns] : []), ...(selected.rtc ? rtc : [])];
    const ctx = { controller: new AbortController(), epoch: hostEpoch, scope: single ? scope : 'all', selected, start: performance.now(), done: 0, total: (selected.ip ? 2 : 0) + (selected.dns ? 1 : 0) + (selected.rtc ? providers.length : 0) + (selected.connect ? 1 : 0) };
    tellHost('started', ctx.epoch);
    active = ctx; lastTime = new Date().toLocaleString('zh-CN', { hour12: false });
    lastScope = single ? scope === 'dns' ? 'DNS 解析来源' : 'WebRTC 出口对照' : '所选检测项目';
    currentRows.forEach(row => { row.sampledAt = lastTime; });
    $('run-time').textContent = '本次开始于 ' + lastTime;
    $('overall').textContent = single ? '正在单独检测 ' + (scope === 'dns' ? 'DNS 解析来源' : 'WebRTC 出口对照') + '…' : '正在采样，接口失败会单独标出';
    $('browser-progress').dataset.state = 'running';
    $('elapsed').textContent = '已用时 0.0 秒';
    $('progress').classList.add('running'); toggleControls(true); progress(ctx); render();
    const ticker = setInterval(() => { $('elapsed').textContent = '已用时 ' + ((performance.now() - ctx.start) / 1000).toFixed(1) + ' 秒'; }, 200);
    // IPLeak samples serially up to 300 times. Do not truncate that sequence
    // with a core deadline; the user can stop and retain the partial results.
    let deadline = selected.dns ? undefined : setTimeout(() => { ctx.timedOut = true; ctx.controller.abort(); }, 55000);
    const jobs = [];
    if (selected.ip) { jobs.push(() => probeIp(4, ctx)); jobs.push(() => probeIp(6, ctx)); }
    if (selected.dns) jobs.push(() => probeDns(ctx));
    if (selected.rtc) rtc.forEach(row => jobs.push(() => probeRtc(row, ctx)));
    let websiteIncomplete = selected.connect ? 1 : 0;
    if (selected.connect) window.RoseConnectivity.clear();
    try {
      const runJob = job => Promise.resolve().then(job).finally(() => { ctx.done++; progress(ctx); });
      const outcomes = await Promise.allSettled(jobs.map(runJob));
      // Website batches can produce 150 requests. Finish the public-IP, DNS and
      // ICE observations first so those probes do not compete with site traffic.
      if (selected.connect) {
        if (ctx.controller.signal.aborted) { ctx.done++; progress(ctx); }
        else {
          clearTimeout(deadline);
          deadline = setTimeout(() => { ctx.timedOut = true; ctx.controller.abort(); }, 55000);
          $('overall').textContent = '出口采样已结束，正在检测网站连通性…';
          outcomes.push(...await Promise.allSettled([runJob(async () => { websiteIncomplete = await window.RoseConnectivity.run(ctx.controller.signal); })]));
        }
      }
      const incomplete = currentRows.filter(row => ['failed', 'unavailable', 'cancelled'].includes(row.status)).length + (websiteIncomplete ? 1 : 0);
      const crashed = outcomes.some(result => result.status === 'rejected');
      $('overall').textContent = ctx.timedOut ? '检测超时，保留已取得的结果' : ctx.controller.signal.aborted ? '已停止 · 采样可能不完整' : crashed ? '部分任务异常，请查看结果' : incomplete ? '检测结束 · ' + incomplete + ' 项待确认' : '检测结束 · 已取得本次采样';
    } finally {
      clearInterval(ticker); clearTimeout(deadline);
      currentRows.forEach(row => { if (row.status === 'running') { row.status = 'unavailable'; row.note = '任务未正常结束，请重新检测'; } });
      $('elapsed').textContent = '本次用时 ' + ((performance.now() - ctx.start) / 1000).toFixed(1) + ' 秒';
      active = null; $('browser-progress').dataset.state = 'complete'; $('progress').classList.remove('running'); $('start-label').textContent = '重新检测浏览器网络'; toggleControls(false); render();
      const websiteStatus = !selected.connect ? 'skipped' : ctx.controller.signal.aborted ? 'cancelled' : websiteIncomplete ? 'unavailable' : 'ready';
      tellHost('completed', ctx.epoch, [selected.ip ? ip4.status : 'skipped', selected.ip ? ip6.status : 'skipped', selected.dns ? dns.status : 'skipped', ...rtc.map(row => selected.rtc ? row.status : 'skipped'), websiteStatus]);
    }
  }

  function report() {
    const environment = window.chrome && window.chrome.webview ? '桌面版 WebView2' : '当前浏览器（本地开发页面）';
    const lines = ['身后红玫瑰 · 网络检测报告', '开始时间：' + lastTime, '本次范围：' + lastScope + (lastScope === '所选检测项目' ? '' : '；其他项目保留各自的已有结果，请参考各项采样时间。'), '环境：' + environment + '；不代表所有外部浏览器。', $('overall').textContent, ''];
    [['IPv4', ip4], ['IPv6', ip6]].forEach(([name, data]) => lines.push(name + '：' + (data.address || labels[data.status]) + '；' + data.note, '采样时间：' + (data.sampledAt || '未采样'), '地区：' + data.geo, '来源：ipify' + (data.geo.includes('IPPure') ? ' / IPPure' : '')));
    lines.push('', 'DNS：' + labels[dns.status] + '；' + dns.note, '采样时间：' + (dns.sampledAt || '未采样'), '来源：https://ipleak.net/ · 浏览器以同一会话顺序采样，最多 300 次；归属来自 IPLeak 公开 JSON 接口。');
    dns.sources.forEach(source => lines.push(source.sourceName + '：' + labels[source.status] + ' | ' + (source.completedQueries || 0) + ' / ' + (source.totalQueries || 300) + ' 次请求 | ' + (source.failedQueries || 0) + ' 次失败' + (typeof source.serverCount === 'number' ? ' | 服务器数 ' + source.serverCount : '') + ' | ' + source.note));
    dns.rows.forEach(row => {
      lines.push([row.address, Number.isSafeInteger(row.hits) ? row.hits + ' 次命中' : '', row.hostname, row.isp, [row.country, row.region, row.city].filter(Boolean).join(' / '), row.metadataStatus === 'ready' ? '' : '归属未取得', '采样来源 ' + row.sources.join('、')].filter(value => value !== undefined && value !== null && value !== '').join(' | '));
      if (row.details) lines.push('IPLeak 原始归属：' + JSON.stringify(row.details));
    });
    lines.push('', 'WebRTC：IPCheck.ing / MyIP，4 个 STUN 来源并行、每源最长 5 秒、首个映射候选；候选类型不等于完整 NAT 类型。');
    rtc.forEach(row => { lines.push(row.name + ' / ' + row.host + '：' + labels[row.status] + '；' + row.note + (row.candidateType ? '；候选类型 ' + row.candidateType : '') + '；采样时间：' + (row.sampledAt || '未采样')); row.addresses.forEach(ip => lines.push(ip + ' — ' + R.compare(ip, [ip4.address, ip6.address]).text)); });
    lines.push('', window.RoseConnectivity.report());
    lines.push('', '超时或未取得地址不等于无泄漏。DNS 解析器与网站出口 IP 不同属于常见情况。');
    return lines.join('\n');
  }
  $('start').addEventListener('click', () => start());
  for (const scope of ['dns', 'rtc']) $(scope + '-run')?.addEventListener('click', () => {
    if (active?.scope === scope) { $('overall').textContent = '正在停止…'; active.controller.abort(); }
    else if (!active) start(scope);
  });
  $('geo-retry').addEventListener('click', () => document.getElementById('ip-quality')?.scrollIntoView({behavior:'smooth',block:'start'}));
  $('stop').addEventListener('click', () => { if (active) $('overall').textContent = '正在停止…'; window.RoseConnectivity.stop(); if (active) active.controller.abort(); });
  $('clear').addEventListener('click', () => {
    if (active || window.RoseConnectivity?.isRunning()) return; window.RoseConnectivity.clear();reset(); lastTime = ''; lastScope = ''; render(); toggleControls(false);
    $('browser-progress').dataset.state = 'idle';
    $('overall').textContent = '点击“检测浏览器网络”开始采样'; $('start-label').textContent = '检测浏览器网络';
    $('progress-fill').style.width = '0%'; $('progress').setAttribute('aria-valuenow', '0');
    $('progress-text').textContent = '0 / 0'; $('elapsed').textContent = '等待开始'; $('run-time').textContent = '结果不会自动保存';
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(report()); $('copy-label').textContent = '已复制'; }
    catch (_) { $('copy-label').textContent = '复制失败'; }
    clearTimeout(copyFeedbackTimer); copyFeedbackTimer = setTimeout(() => { $('copy-label').textContent = '复制报告'; }, 1800);
  });
  let toastTimer;
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const data = button.dataset.copy === 'ip4' ? ip4 : ip6;
    if (!data.address) return;
    try { await navigator.clipboard.writeText(data.address); $('copy-feedback').textContent = '已复制 IP 地址'; }
    catch (_) { $('copy-feedback').textContent = '复制失败，请手动选择地址'; }
    $('copy-feedback').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('copy-feedback').hidden = true; }, 1800);
  }));
  window.addEventListener('pagehide', () => { if (active) active.controller.abort(); });
  if (location.hostname === 'diagnostics.behindrose.invalid' && window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'theme') { document.documentElement.dataset.theme = message.light ? 'light' : 'dark'; return; }
    if (typeof message.epoch !== 'string' || !/^[a-f0-9]{32}$/.test(message.epoch)) return;
    if (message.kind === 'epoch') hostEpoch = message.epoch;
    if (message.kind === 'stop') { window.RoseConnectivity.stop(); if (active) active.controller.abort(); hostEpoch = message.epoch; }
    if (message.kind === 'start') { hostEpoch = message.epoch; start(); }
  });
  reset(); render(); // No request is made until the user clicks Start.
})();
