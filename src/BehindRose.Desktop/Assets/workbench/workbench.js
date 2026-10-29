(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"/></svg>`;
  const titles = { overview: '一键配置', network: '网络检测', claude: 'Claude Code', backups: '恢复记录', settings: '帮助与关于' };
  // Built-in protection plan: system capture, browser DNS and Clash IPv6 off.
  // Reuse existing groups and the original profile script; apply the DNS delta.
  const automaticOptions = 1 | 2 | 4 | 8 | 32 | 64;
  const networkSections = { 'browser-network': '网络检测', connectivity: '网络检测', 'ip-quality': '网络检测' };
  let token, ready = false, busy = false, submitting = false, planning = false, health, lastOperation, page, toastTimer, statusPending = false, healthPending = false;
  let frameLoaded = false, frameObserver, desktop = false;
  let claudeBusy = false, reportedConfigBusy = false;
  addEventListener('claude-config-busy', event => { claudeBusy = event.detail === true; controls(); });
  async function desktopUpdateStatus() {
    if (!desktop) return;
    const response = await fetch('/api/update-status', { cache: 'no-store' });
    if (!response.ok) return;
    const state = await response.json();
    $('app-version').textContent = `当前版本 ${state.version}`;
    $('desktop-update-status').textContent = state.status;
    $('desktop-update-check').disabled = !state.enabled || state.checking;
  }
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
  $('desktop-update-check').addEventListener('click', attempt(async () => {
    const response = await fetch('/api/update-check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': token }, body: '{}' });
    if (!response.ok) throw Error('更新检查未能启动，请稍后重试。');
    await desktopUpdateStatus();
  }));
  function controls() {
    const locked = busy || claudeBusy;
    document.body.dataset.configBusy = String(locked);
    for (const id of ['health-refresh', 'backups-refresh', 'copy-report', 'open-clash', 'full-backup-create']) $(id).disabled = !ready || locked || planning;
    $('protect-now').disabled = !ready || locked || planning || !health || protectionState().blocked;
    $('reconfigure-now').disabled = !ready || locked || planning || !health || protectionState().blocked;
    document.querySelectorAll('[data-restore],[data-full-restore]').forEach(input => input.disabled = !ready || locked || planning);
    document.querySelectorAll('.review-confirm').forEach(input => input.disabled = locked);
    document.querySelectorAll('.execute-plan').forEach(button => button.disabled = !ready || locked || !button.closest('.review-body').querySelector('.review-confirm').checked);
    $('network-frame').inert = locked;
    if (reportedConfigBusy !== locked) {
      reportedConfigBusy = locked;
      dispatchEvent(new CustomEvent('workbench-config-busy', { detail: locked }));
    }
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
    $('desktop-updates').hidden = !desktop || page !== 'settings';
    if (desktop && page === 'settings') desktopUpdateStatus().catch(() => {});
    document.querySelectorAll('.page').forEach(section => section.hidden = section.id !== 'page-' + page);
    document.querySelectorAll('a[data-page],button[data-page]').forEach(link => link.dataset.page === page ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current'));
    const label = page === 'network' ? networkSections[target] || networkSections['browser-network'] : titles[page];
    document.title = label + ' · Rose in my wake';
    if (page === 'network') { network(); focusNetworkSection(); }
    if (page === 'backups' && ready && !busy) try { await loadBackups(); } catch (error) { notice(error.message); }
  }
  addEventListener('hashchange', () => { notice(); navigate(); window.scrollTo(0, 0); }); navigate();

  function protectionState() {
    const selected = health?.findings.slice(0, 4) || [];
    const ipv6 = health?.clashIpv6;
    const singMix = health?.singMix;
    const blocked = !!health && (!health.host.compatible || selected.length !== 4 || !ipv6 || [...selected, ipv6, singMix].some(item => item && ['无法自动修改', '未找到', '由管理员管理'].includes(item.state)));
    const configured = selected.length === 4 && selected.every(item => item.state === '已配置') && ipv6?.state === '已关闭' && singMix?.state === '已配置';
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
    $('health-kicker').textContent = health.demo ? '演示状态' : configured ? '配置已保存 · 未验证' : blocked ? '当前环境需要处理' : '已完成本机检查';
    $('health-title').innerHTML = configured ? 'DNS 配置已保存<br>请检测实际出口' : blocked ? '暂不能<br>自动配置' : '系统接管<br>与 DNS 配置';
    const issues = [...health.findings, health.clashIpv6, health.singMix].filter(item => item && ['无法自动修改', '未找到', '由管理员管理'].includes(item.state));
    $('health-note').textContent = configured ? 'DNS 增量防护已保存，沿用你的代理组、节点和原有分流。重新打开 Clash 和浏览器后，请检测实际 DNS 出口。已保存不代表实测无泄漏。' : blocked ? !health.host.compatible ? health.host.note || '当前配置结构尚未识别，请查看配置详情后刷新。' : issues.map(item => item.title + '：' + item.detail).join('；') || '暂时无法取得完整配置状态，请刷新状态后重试。' : '沿用你的本机代理组和分流，补齐 6 个检测站点的 DNS 防护及网易／战网直连。保留现有节点、策略组和原规则，先预览差异，再备份应用。';
    $('protect-label').textContent = configured ? '检测配置效果' : blocked ? '暂不可自动配置' : '一键配置';
    $('reconfigure-now').hidden = !configured;
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
      $('host-status').textContent = data.host.found || data.host.compatible ? `${data.host.running ? '正在运行' : '已退出'} · ${data.host.compatible ? '配置结构已识别' : '配置结构需检查'}` : '未识别到客户端';
      $('checked-time').textContent = '本机配置';
      const detection = desktop
        ? { title: '桌面检测出口', state: data.detectionProxyPort ? '已识别代理' : '未识别代理', detail: data.detectionProxyPort
          ? '桌面检测启动时绑定本机 Clash HTTP／混合端口 127.0.0.1:' + data.detectionProxyPort + '；端口变化后请重启工具箱。'
          : '没有识别到正在监听的 Clash HTTP／混合端口，目前沿用系统网络，不能据此判定代理防护有效。' }
        : { title: '开发页检测出口', state: '跟随浏览器', detail: '开发页使用当前浏览器的网络设置；桌面工具箱会读取本机 Clash HTTP／混合端口。' };
      $('findings').innerHTML = [...data.findings, ...(data.singMix ? [data.singMix] : []), ...(data.tunRuntime ? [data.tunRuntime] : []), detection].map(item => {
        const good = item.state === '已配置', warning = ['无法自动修改', '未找到', '由管理员管理'].includes(item.state);
        return `<div class="finding"><span class="finding-mark ${good ? 'ok' : ''}">${icon(good ? 'check' : item.title.includes('DNS') ? 'globe' : 'route')}</span><div class="finding-copy"><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></div><span class="badge ${good ? 'ok' : warning ? 'warning' : 'neutral'}">${esc(item.state)}</span></div>`;
      }).join('');
    } finally { healthPending = false; controls(); }
  }
  $('health-refresh').addEventListener('click', attempt(checkHealth));

  function renderPreview(container, preview) {
    const full = preview.action === 'full-restore', restore = full || preview.action === 'restore';
    const changes = full ? [{ title: 'Clash 完整配置', beforeText: '当前配置（将先保存加密快照）', afterText: `还原 ${preview.preview.fileCount} 个文件；写入 ${preview.preview.writeCount} 个，移除备份后新增的 ${preview.preview.removeCount} 个文件` }] : preview.changes;
    const needsClashExit = full || preview.needsClashExit, clashRunning = full ? preview.preview.clashRunning : preview.clashRunning;
    const tunDetails = !restore && Array.isArray(preview.tun) && preview.tun.length ? `<section class="tun-preview" aria-labelledby="tun-preview-title"><h3 id="tun-preview-title">虚拟网卡会这样配置</h3><p>支持 System、GVisor、Mixed、Mips；沿用已有协议栈，自动配置接管所需开关。</p><dl>${preview.tun.map(item => `<div><dt>${esc(item.title)}</dt><dd><span>${esc(item.detail)}</span><small>${esc(item.state)}</small></dd></div>`).join('')}</dl></section>` : '';
    container.innerHTML = `<div class="review-body"><div class="preview-heading"><h2>${full ? '恢复到所选备份时间点' : restore ? '恢复范围' : '一键配置方案'}</h2><span class="badge ${changes.length ? 'active' : 'ok'}">${full ? '本机加密备份' : changes.length + ' 项调整'}</span></div><p class="preview-caption">${full ? (preview.preview.complete ? '将恢复订阅、节点、脚本、分流、DNS 和 TUN 设置。当前配置会被所选时间点覆盖，恢复前自动保存快照。' : '这是恢复前保存的不完整状态快照，用于撤销上次恢复；确认后将还原该状态。') : changes.length ? restore ? '确认后，将恢复以下设置。' : '应用前先在本机加密保存完整 Clash 配置，再备份本次调整涉及的设置。' : '配置已经就绪，无需重复调整。'}</p>${tunDetails}${changes.map(change => `<div class="change"><strong>${esc(change.title)}</strong><div class="change-diff"><span>${esc(change.beforeText)}</span>${icon('chevron')}<span>${esc(change.afterText)}</span></div></div>`).join('')}${needsClashExit ? `<p class="preview-reminder">${clashRunning ? '请先从系统托盘退出 Clash，再继续。' : '操作期间请保持 Clash 关闭，完成后再打开。'}</p>` : ''}${changes.length || restore ? `<label class="confirm-row"><input type="checkbox" class="review-confirm">我已确认${restore ? '本次恢复范围' : '本次配置调整'}</label><div class="review-actions"><button class="primary execute-plan" disabled>${icon(restore ? 'reset' : 'shield')}${full ? '一键恢复完整配置' : restore ? '恢复原设置' : '确认应用配置'}</button><span>${full ? '仅在本机还原' : '需要 Windows 管理员授权'}</span></div>` : '<a href="#network" class="secondary finished-preview">检测防护效果 →</a>'}</div>`;
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
        const result = await api(full ? 'clash-full-restore' : 'execute', { planId: preview.id });
        submitting = false;
        $('restore-dialog').close(); $('protection-dialog').close();
        displayOperation(result.operation);
      } catch (error) { submitting = false; busy = false; controls(); localError.textContent = error.message; localError.hidden = false; localError.scrollIntoView({ block: 'nearest' }); }
    }));
    controls();
  }
  async function prepareProtection(reconfigure = false) {
    if (!ready || busy || claudeBusy || planning || !health) return;
    const { configured, blocked } = protectionState();
    if (configured && !reconfigure) { location.hash = 'network'; return; }
    if (blocked) return;
    planning = true; controls(); $(reconfigure ? 'reconfigure-label' : 'protect-label').textContent = '正在生成变更预览…';
    try {
      renderPreview($('quick-review'), await api('plan', { options: automaticOptions }));
      $('protection-dialog').showModal();
    } finally { planning = false; $('reconfigure-label').textContent = '再次配置'; presentProtection(); controls(); }
  }
  $('protect-now').addEventListener('click', attempt(() => prepareProtection()));
  $('reconfigure-now').addEventListener('click', attempt(() => prepareProtection(true)));
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
      const [items] = await Promise.all([api('backups'), loadFullBackups()]);
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
  const fullReasons = { manual: '手动完整备份', 'before-repair': '防护配置前自动备份', 'before-restore': '完整恢复前自动快照' };
  async function loadFullBackups() {
    const items = await api('clash-full-backups');
    $('full-backup-count').textContent = `${items.filter(item => item.complete && item.canRestore).length} 份完整配置可恢复 · ${items.length} 条本机记录`;
    $('full-backup-list').innerHTML = items.length ? items.map(item => `<article class="card backup-card"><span class="section-icon">${icon('backup')}</span><div><h3>${esc(item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false }) : '备份无法读取')}<span class="badge ${item.state === 'recovery-required' || item.error ? 'warning' : 'neutral'}">${item.state === 'recovery-required' ? '需要恢复' : item.complete ? '完整配置' : '恢复前快照'}</span></h3><p>${esc(item.error || `${item.fileCount} 个文件 · ${(item.totalBytes / 1048576).toFixed(1)} MiB · ${fullReasons[item.reason] || '本机备份'}`)}</p><small>${item.complete ? '订阅 · 节点 · 脚本 · 分流 · DNS · TUN' : '用于还原恢复前的状态'}</small></div>${item.canRestore ? `<button class="secondary" data-full-restore="${esc(item.id)}">${icon('reset')}一键恢复</button>` : ''}</article>`).join('') : '<p class="full-backup-empty">尚无完整备份。先点击“立即完整备份”，以后订阅或配置丢失时即可恢复。</p>';
    $('full-backup-list').querySelectorAll('[data-full-restore]').forEach(button => button.addEventListener('click', attempt(async () => {
      if (planning || busy) return;
      planning = true; controls();
      try { renderPreview($('restore-review'), await api('clash-full-restore-plan', { backupId: button.dataset.fullRestore })); $('restore-dialog').showModal(); }
      finally { planning = false; controls(); }
    })));
  }
  $('full-backup-create').addEventListener('click', attempt(async () => {
    if (busy || planning) return;
    submitting = true; busy = true; controls();
    try { const result = await api('clash-full-backup'); submitting = false; displayOperation(result.operation); }
    catch (error) { submitting = false; busy = false; controls(); throw error; }
  }));
  $('backups-refresh').addEventListener('click', attempt(loadBackups));
  $('close-restore').addEventListener('click', () => $('restore-dialog').close());

  function displayOperation(op) {
    if (submitting) return;
    if (!op) { busy = false; controls(); return; }
    const newlyDone = op.done && (!lastOperation || !lastOperation.done || lastOperation.id !== op.id);
    lastOperation = op; busy = !op.done; $('operation').hidden = false;
    $('operation-title').textContent = !op.done ? (op.action === 'full-backup' ? '正在完整备份' : op.action === 'full-restore' ? '正在恢复完整配置' : op.phase === 'authorizing' ? '等待管理员授权' : '正在配置防护') : op.result?.success ? (op.result.state === 'unchanged' ? '无需修改配置' : op.action === 'full-backup' ? '完整备份已保存在本机' : op.action === 'full-restore' ? '完整配置已恢复' : op.action === 'restore' ? '原设置已恢复' : '防护配置已就绪') : op.phase === 'cancelled' ? '已取消操作' : '本次操作未完成';
    $('operation-message').textContent = op.message;
    $('operation-actions').hidden = !op.done || !op.result?.success || op.action === 'full-backup';
    controls();
    if (newlyDone) {
      checkHealth().catch(error => notice(error.message));
      if (page === 'backups') loadBackups().catch(error => notice(error.message));
    }
  }
  $('open-clash').addEventListener('click', attempt(async () => { const result = await api('open-clash'); toast(result.message); await checkHealth(); }));
  $('copy-report').addEventListener('click', attempt(async () => {
    if (!health) await checkHealth();
    const report = ['Rose in my wake · DNS 防护 v2.0', `体检时间：${new Date(health.checkedAt).toLocaleString('zh-CN')}`, `Clash Verge Rev：${health.host.version}，${health.host.running ? '运行中' : '未运行'}`, ...health.findings.map(item => `${item.title}：${item.state}`)];
    if (lastOperation?.done) report.push(`最近操作：${lastOperation.action === 'restore' ? '恢复' : '修复'} / ${lastOperation.result?.state || lastOperation.phase}`);
    try { await navigator.clipboard.writeText(report.join('\n')); toast('已复制配置摘要'); }
    catch { throw Error('浏览器未允许复制，请允许剪贴板权限后重试。'); }
  }));

  async function connect() {
    try {
      const response = await fetch('/api/session'); if (!response.ok) throw Error('无法连接本机服务。');
      const session = await response.json(); token = session.token; ready = session.ready; controls();
      desktop = session.desktop === true;
      if (desktop) {
        $('dev-state').textContent = `桌面应用 · ${session.version}`;
        document.querySelector('.development-details').hidden = true;
        $('desktop-updates').hidden = page !== 'settings';
        await desktopUpdateStatus();
      }
      if (!ready) { $('health-title').textContent = session.error || '正在准备 DNS 防护…'; setTimeout(connect, 1800); return; }
      const status = await api('status'); displayOperation(status.operation);
      if (!busy) { await checkHealth(); if (page === 'backups') await loadBackups(); }
    } catch (error) { ready = false; controls(); $('health-title').textContent = '暂时无法读取防护状态'; notice(error.message); setTimeout(connect, 3000); }
  }
  setInterval(async () => {
    if (!ready || statusPending) return;
    statusPending = true;
    try { displayOperation((await api('status')).operation); if (desktop && page === 'settings') await desktopUpdateStatus(); }
    catch (error) { ready = false; controls(); notice(error.message); setTimeout(connect, 2000); }
    finally { statusPending = false; }
  }, 1800);
  controls(); connect();
})();

