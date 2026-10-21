(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"/></svg>`;
  const titles = { overview: '一键配置', network: '网络检测', backups: '恢复记录', settings: '帮助与关于' };
  // Built-in protection plan: system capture, browser DNS and Clash IPv6 off.
  // Keep the user's upstream DNS servers (ReplaceDns = 16) outside this plan.
  const automaticOptions = 1 | 2 | 4 | 8 | 32;
  const networkSections = { 'browser-network': '网络检测', connectivity: '网络检测', 'ip-quality': '网络检测' };
  let token, ready = false, busy = false, submitting = false, planning = false, health, lastOperation, page, toastTimer, statusPending = false, healthPending = false;
  let frameLoaded = false, frameObserver;
  function syncDarkTheme() {
    document.documentElement.dataset.theme = 'dark';
    if (frameLoaded) $('network-frame').contentDocument.documentElement.dataset.theme = 'dark';
  }
  syncDarkTheme();

  function notice(message = '') { $('message').textContent = message; $('message').hidden = !message; }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 2800); }
  async function api(command, fields = {}) {
    if (!ready) throw Error('本机服务尚未就绪，请稍候。');
    const response = await fetch('/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': token }, body: JSON.stringify({ command, ...fields }) });
    const result = await response.json();
    if (!response.ok || result.error) throw Error(result.error || '本机请求未完成。');
    return result.data;
  }
  const attempt = action => async event => { notice(); try { await action(event); } catch (error) { notice(error.message); } };
  function controls() {
    for (const id of ['health-refresh', 'backups-refresh', 'copy-report', 'open-clash']) $(id).disabled = !ready || busy;
    $('protect-now').disabled = !ready || busy || planning || !health || protectionState().blocked;
    document.querySelectorAll('[data-restore]').forEach(input => input.disabled = !ready || busy || planning);
    document.querySelectorAll('.review-confirm').forEach(input => input.disabled = busy);
    document.querySelectorAll('.execute-plan').forEach(button => button.disabled = !ready || busy || !button.closest('.review-body').querySelector('.review-confirm').checked);
    $('network-frame').inert = busy;
  }
  function network() {
    const frame = $('network-frame');
    if (!frame.getAttribute('src')) frame.src = '/network';
    frame.hidden = false;
  }
  function focusNetworkSection() {
    const hash = location.hash.slice(1);
    if (page !== 'network' || !frameLoaded) return;
    const target = Object.hasOwn(networkSections, hash) ? hash : 'ip-quality';
    const frame = $('network-frame');
    frame.title = networkSections[target];
    frame.contentWindow.dispatchEvent(new CustomEvent('network-view', { detail: target }));
    const height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height);
    if (height > 0) frame.style.height = `${height + 2}px`;
    requestAnimationFrame(() => {
      if (page !== 'network' || location.hash.slice(1) !== hash) return;
      const section = frame.contentDocument.getElementById(target);
      if (!section) return;
      const top = window.scrollY + frame.getBoundingClientRect().top + section.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, top - document.querySelector('.topbar').getBoundingClientRect().height - 20), behavior: 'instant' });
    });
  }
  addEventListener('network-section', event => {
    if (!Object.hasOwn(networkSections, event.detail)) return;
    if (location.hash === '#' + event.detail) focusNetworkSection();
    else location.hash = event.detail;
  });
  $('network-frame').addEventListener('load', () => {
    const frame = $('network-frame');
    frameLoaded = true; syncDarkTheme(); frameObserver?.disconnect();
    const resize = () => { const height = Math.ceil(frame.contentDocument.body.getBoundingClientRect().height); if (height > 0) frame.style.height = `${height + 2}px`; };
    frameObserver = new ResizeObserver(resize); frameObserver.observe(frame.contentDocument.body); resize();
    frame.contentDocument.querySelector('.network-section-links')?.addEventListener('click', event => {
      const link = event.target.closest('a');
      const target = link?.hash === '#ipv4-title' ? 'browser-network' : link?.hash.slice(1);
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !Object.hasOwn(networkSections, target)) return;
      event.preventDefault();
      dispatchEvent(new CustomEvent('network-section', { detail: target }));
    });
    focusNetworkSection();
  });
  async function navigate() {
    if (location.hash === '#repair') history.replaceState(null, '', '#overview');
    const target = location.hash.slice(1); page = titles[target] ? target : 'network';
    document.body.dataset.page = page;
    document.querySelectorAll('.page').forEach(section => section.hidden = section.id !== 'page-' + page);
    document.querySelectorAll('a[data-page],button[data-page]').forEach(link => link.dataset.page === page ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'));
    const label = page === 'network' ? networkSections[target] || networkSections['browser-network'] : titles[page];
    document.title = label + ' · 身后红玫瑰';
    if (page === 'network') { network(); focusNetworkSection(); }
    if (page === 'backups' && ready && !busy) try { await loadBackups(); } catch (error) { notice(error.message); }
  }
  addEventListener('hashchange', () => { notice(); navigate(); window.scrollTo(0, 0); }); navigate();

  function protectionState() {
    const selected = health?.findings.slice(0, 4) || [];
    const ipv6 = health?.clashIpv6;
    const blocked = !!health && (!health.host.compatible || selected.length !== 4 || !ipv6 || [...selected, ipv6].some(item => item && ['无法自动修改', '未找到', '由管理员管理'].includes(item.state)));
    const configured = selected.length === 4 && selected.every(item => item.state === '已配置') && ipv6?.state === '已关闭';
    return { blocked: blocked && !configured, configured };
  }
  function presentClashIpv6() {
    const finding = health?.clashIpv6;
    $('clash-ipv6-status').textContent = 'Clash IPv6：' + (finding?.state || '暂不可读取');
  }
  function presentProtection() {
    if (!health) return;
    const { configured, blocked } = protectionState();
    $('protection-hero').dataset.state = configured ? 'configured' : 'pending';
    $('health-kicker').textContent = health.demo ? '演示状态' : configured ? '配置已完成 · 待检测' : blocked ? '当前环境需要处理' : '已完成本机检查';
    $('health-title').innerHTML = configured ? '防护配置<br>已准备就绪' : blocked ? '暂不能<br>自动配置' : '系统接管<br>与 DNS 配置';
    const issues = [...health.findings, health.clashIpv6].filter(item => item && ['无法自动修改', '未找到', '由管理员管理'].includes(item.state));
    $('health-note').textContent = configured ? '系统接管与浏览器 DNS 已配置，Clash IPv6 已关闭。可以检测实际出口，确认连接是否按预期工作。' : blocked ? !health.host.compatible ? health.host.note || '当前配置结构尚未识别，请查看配置详情后刷新。' : issues.map(item => item.title + '：' + item.detail).join('；') || '暂时无法取得完整配置状态，请刷新状态后重试。' : '统一开启 TUN、自动路由与 DNS 接管，配置浏览器 DNS，并关闭 Clash IPv6。先预览改动，确认后备份并应用。';
    $('protect-label').textContent = configured ? '检测配置效果' : blocked ? '暂不可自动配置' : '一键配置';
    const system = health.findings[0];
    $('system-status').textContent = system?.state === '已配置' ? '已配置' : system?.state === '未找到' ? '未识别' : '待配置';
    $('system-status').className = 'badge ' + (system?.state === '已配置' ? 'ok' : 'neutral');
    const browsers = health.findings.slice(1).filter(item => item.state === '已配置');
    $('browser-scope').textContent = 'Chrome · Edge · Firefox';
    $('browser-status').textContent = browsers.length === 3 ? '已配置' : browsers.length ? browsers.length + ' / 3 已配置' : '待配置';
    $('browser-status').className = 'badge ' + (browsers.length === 3 ? 'ok' : 'neutral');
  }
  $('close-support').addEventListener('click', () => $('support-dialog').close());

  async function checkHealth() {
    if (healthPending) return;
    healthPending = true; $('health-refresh').disabled = true;
    try {
      const data = await api('health'); health = data;
      presentProtection(); presentClashIpv6();
      $('health-meta').textContent = '最近检查 ' + new Date(data.checkedAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
      $('host-version').textContent = data.host.version;
      $('host-status').textContent = data.host.found ? `${data.host.running ? '正在运行' : '已退出'} · ${data.host.compatible ? '配置结构已识别' : '配置结构需检查'}` : '未识别到客户端';
      $('checked-time').textContent = '本机配置';
      $('findings').innerHTML = data.findings.map(item => {
        const good = item.state === '已配置', warning = ['无法自动修改', '未找到', '由管理员管理'].includes(item.state);
        return `<div class="finding"><span class="finding-mark ${good ? 'ok' : ''}">${icon(good ? 'check' : item.title.includes('DNS') ? 'globe' : 'route')}</span><div class="finding-copy"><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></div><span class="badge ${good ? 'ok' : warning ? 'warning' : 'neutral'}">${esc(item.state)}</span></div>`;
      }).join('');
    } finally { healthPending = false; controls(); }
  }
  $('health-refresh').addEventListener('click', attempt(checkHealth));

  function renderPreview(container, preview) {
    const restore = preview.action === 'restore', changes = preview.changes;
    container.innerHTML = `<div class="review-body"><div class="preview-heading"><h2>${restore ? '恢复范围' : '一键配置方案'}</h2><span class="badge ${changes.length ? 'active' : 'ok'}">${changes.length} 项调整</span></div><p class="preview-caption">${changes.length ? restore ? '确认后，将恢复以下设置。' : '开启前会自动备份当前设置，以便之后恢复。' : '配置已经就绪，无需重复调整。'}</p>${changes.map(change => `<div class="change"><strong>${esc(change.title)}</strong><div class="change-diff"><span>${esc(change.beforeText)}</span>${icon('chevron')}<span>${esc(change.afterText)}</span></div></div>`).join('')}${preview.needsClashExit ? `<p class="preview-reminder">${preview.clashRunning ? '请先从系统托盘退出 Clash，再继续开启防护。' : '开启期间请保持 Clash 关闭，完成后再打开。'}</p>` : ''}${changes.length || restore ? `<label class="confirm-row"><input type="checkbox" class="review-confirm">我已确认${restore ? '本次恢复范围' : '本次配置调整'}</label><div class="review-actions"><button class="primary execute-plan" disabled>${icon(restore ? 'reset' : 'shield')}${restore ? '恢复原设置' : '确认应用配置'}</button><span>需要 Windows 管理员授权</span></div>` : '<a href="#network" class="secondary finished-preview">检测防护效果 →</a>'}</div>`;
    container.hidden = false;
    const localError = document.createElement('p'); localError.className = 'notice'; localError.hidden = true; localError.setAttribute('role', 'alert');
    container.querySelector('.review-body').append(localError);
    container.querySelector('.finished-preview')?.addEventListener('click', () => $('protection-dialog').close());
    container.querySelector('.review-confirm')?.addEventListener('change', controls);
    container.querySelector('.execute-plan')?.addEventListener('click', attempt(async () => {
      if (busy) return;
      submitting = true; busy = true; localError.hidden = true; controls();
      if (frameLoaded) { $('network-frame').contentWindow.RoseConnectivity?.stop(); $('network-frame').contentDocument.getElementById('stop')?.click(); }
      try {
        const result = await api('execute', { planId: preview.id });
        submitting = false;
        $('restore-dialog').close(); $('protection-dialog').close();
        displayOperation(result.operation);
      } catch (error) { submitting = false; busy = false; controls(); localError.textContent = error.message; localError.hidden = false; localError.scrollIntoView({ block: 'nearest' }); }
    }));
    controls();
  }
  async function prepareProtection() {
    if (!ready || busy || planning || !health) return;
    const { configured, blocked } = protectionState();
    if (configured) { location.hash = 'network'; return; }
    if (blocked) return;
    planning = true; controls(); $('protect-label').textContent = '正在生成变更预览…';
    try {
      renderPreview($('quick-review'), await api('plan', { options: automaticOptions }));
      $('protection-dialog').showModal();
    } finally { planning = false; presentProtection(); controls(); }
  }
  $('protect-now').addEventListener('click', attempt(prepareProtection));
  $('close-protection').addEventListener('click', () => $('protection-dialog').close());

  const states = { applied: '可恢复', applying: '操作中断', 'rollback-failed': '需要恢复', restored: '已恢复', 'rolled-back': '已回滚', prepared: '未开始写入', unreadable: '无法读取' };
  function backupCard(item) {
    const warning = item.error || item.restoreBlockedReason || ['applying', 'rollback-failed'].includes(item.state);
    const label = item.restoreBlockedReason ? '恢复已暂停' : states[item.state] || item.state;
    const time = item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '时间无法读取';
    const scope = item.error || item.titles.join(' · ');
    const origin = item.state === 'unreadable' ? '异常备份记录' : item.kind === 'restore' ? '恢复前自动保存' : '防护调整前自动保存';
    return `<article class="card backup-card"><span class="section-icon">${icon(item.kind === 'restore' ? 'reset' : 'backup')}</span><div><h3>${esc(time)}<span class="badge ${warning ? 'warning' : item.canRestore ? 'active' : 'neutral'}">${esc(label)}</span></h3><p>${esc(scope)}</p>${item.restoreBlockedReason ? `<p>${esc(item.restoreBlockedReason)}</p>` : ''}<small>${origin} · ${esc(item.id.slice(0, 8))}</small></div>${item.canRestore && !item.error && !item.restoreBlockedReason ? `<button class="secondary" data-restore="${esc(item.id)}">${icon('reset')}恢复设置</button>` : ''}</article>`;
  }
  async function loadBackups() {
    $('backups-refresh').disabled = true;
    try {
      const items = await api('backups');
      const unreadable = items.filter(item => item.state === 'unreadable').length;
      $('backup-count').textContent = `${items.length} 条记录 · ${items.filter(item => item.canRestore && !item.error && !item.restoreBlockedReason).length} 份设置可恢复` + (unreadable ? ` · ${unreadable} 条无法读取，配置修改与恢复已暂停` : '');
      $('backup-list').innerHTML = items.length ? items.map(backupCard).join('') : `<div class="backup-empty">${icon('backup')}<h2>开启防护后，原设置会留在这里</h2><p>每次调整前都会自动备份。需要还原时，选择对应记录即可。</p><a href="#overview" class="secondary">前往一键配置 ${icon('chevron')}</a></div>`;
      $('backup-list').querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', attempt(async () => {
        button.disabled = true;
        try { renderPreview($('restore-review'), await api('restore-plan', { backupId: button.dataset.restore })); $('restore-dialog').showModal(); }
        finally { controls(); }
      })));
    } finally { controls(); }
  }
  $('backups-refresh').addEventListener('click', attempt(loadBackups));
  $('close-restore').addEventListener('click', () => $('restore-dialog').close());

  function displayOperation(op) {
    if (submitting) return;
    if (!op) { busy = false; controls(); return; }
    const newlyDone = op.done && (!lastOperation || !lastOperation.done || lastOperation.id !== op.id);
    lastOperation = op; busy = !op.done; $('operation').hidden = false;
    $('operation-title').textContent = !op.done ? (op.phase === 'authorizing' ? '等待管理员授权' : '正在配置防护') : op.result?.success ? (op.result.state === 'unchanged' ? '无需修改配置' : op.action === 'restore' ? '原设置已恢复' : '防护配置已就绪') : op.phase === 'cancelled' ? '已取消操作' : '本次操作未完成';
    $('operation-message').textContent = op.message;
    $('operation-actions').hidden = !op.done || !op.result?.success;
    controls();
    if (newlyDone) {
      checkHealth().catch(error => notice(error.message));
      if (page === 'backups') loadBackups().catch(error => notice(error.message));
    }
  }
  $('open-clash').addEventListener('click', attempt(async () => { const result = await api('open-clash'); toast(result.message); await checkHealth(); }));
  $('copy-report').addEventListener('click', attempt(async () => {
    if (!health) await checkHealth();
    const report = ['身后红玫瑰 · DNS 防护 v2.0', `体检时间：${new Date(health.checkedAt).toLocaleString('zh-CN')}`, `Clash Verge Rev：${health.host.version}，${health.host.running ? '运行中' : '未运行'}`, ...health.findings.map(item => `${item.title}：${item.state}`)];
    if (lastOperation?.done) report.push(`最近操作：${lastOperation.action === 'restore' ? '恢复' : '修复'} / ${lastOperation.result?.state || lastOperation.phase}`);
    try { await navigator.clipboard.writeText(report.join('\n')); toast('已复制配置摘要'); }
    catch { throw Error('浏览器未允许复制，请允许剪贴板权限后重试。'); }
  }));

  async function connect() {
    try {
      const response = await fetch('/api/session'); if (!response.ok) throw Error('无法连接本机服务。');
      const session = await response.json(); token = session.token; ready = session.ready; controls();
      if (!ready) { $('health-title').textContent = session.error || '正在准备 DNS 防护…'; setTimeout(connect, 1800); return; }
      const status = await api('status'); displayOperation(status.operation);
      if (!busy) { await checkHealth(); if (page === 'backups') await loadBackups(); }
    } catch (error) { ready = false; controls(); $('health-title').textContent = '暂时无法读取防护状态'; notice(error.message); setTimeout(connect, 3000); }
  }
  setInterval(async () => {
    if (!ready || statusPending) return;
    statusPending = true;
    try { displayOperation((await api('status')).operation); }
    catch (error) { ready = false; controls(); notice(error.message); setTimeout(connect, 2000); }
    finally { statusPending = false; }
  }, 1800);
  controls(); connect();
})();

