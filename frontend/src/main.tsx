import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronRight, CircleHelp, Copy,
  Globe2, Heart, Layers3, LockKeyhole, Menu, Monitor, Network,
  PanelLeftClose, Radar, RotateCcw, Settings2, ShieldCheck, X } from 'lucide-react';
import { AnimatedSidebarProvider, AnimatedSidebar, AnimatedSidebarHeader,
  AnimatedSidebarContent, AnimatedSidebarFooter, AnimatedSidebarGroup,
  AnimatedSidebarMenu, AnimatedSidebarMenuItem,
  AnimatedSidebarMenuButton, AnimatedSidebarTrigger } from '@/components/motion/animated-sidebar';
import { Button } from '@/components/motion/button';
import { Switch } from '@/components/motion/switch';
import { Tooltip } from '@/components/motion/tooltip';
import { AnimatedBadge } from '@/components/motion/animated-badge';
import { AnimatedNumber, installReactBits } from './reactbits-integration';
import { networkTools, networkToolFromHash } from './network-tools';

const destinations = [
  { id: 'network', label: '网络检测', icon: Radar, hint: '浏览器 · 网站 · IP 质量' },
  { id: 'overview', label: '一键配置', icon: ShieldCheck, hint: '自动检查并生成配置方案' },
  { id: 'backups', label: '恢复记录', icon: RotateCcw, hint: '备份与还原' },
  { id: 'settings', label: '帮助与关于', icon: Layers3, hint: '帮助与反馈' },
];
const pageFromHash = () => location.hash === '#repair' ? 'overview' : destinations.find(item => item.id === location.hash.slice(1))?.id ?? 'network';
const go = (id: string) => { location.hash = id; };
const click = (id: string, doc: Document = document) => (doc.getElementById(id) as HTMLElement | null)?.click();
const portal = (id: string, content: ReactNode) => createPortal(content, document.getElementById(id)!);

type Sample = {
  loaded: boolean; busy: boolean; running: boolean; copyDisabled: boolean;
  options: boolean[]; overall: string; elapsed: string; count: string; ip: string; activity: string[];
};
const emptySample: Sample = { loaded: false, busy: false, running: false, copyDisabled: true,
  options: [true, true, true, false], overall: '准备就绪', elapsed: '等待开始', count: '—', ip: '尚未采样', activity: [] };

function useSample() {
  const [sample, setSample] = useState(emptySample);
  useEffect(() => {
    const frame = document.getElementById('network-frame') as HTMLIFrameElement;
    let observer: MutationObserver | undefined;
    let detach = () => {};
    const attach = () => {
      observer?.disconnect(); detach();
      const doc = frame.contentDocument;
      if (!doc?.getElementById('start')) return;
      const read = () => {
        const input = (id: string) => doc.getElementById(id) as HTMLInputElement;
        const text = (id: string) => doc.getElementById(id)?.textContent ?? '';
        const next = {
          loaded: true, busy: frame.inert, running: !input('stop').disabled,
          copyDisabled: input('copy').disabled,
          options: ['ip', 'dns', 'rtc', 'connect'].map(id => input('select-' + id).checked),
          overall: text('overall'), elapsed: text('elapsed'),
          count: doc.getElementById('dns-metrics')?.hidden ? '—' : text('dns-count'),
          ip: text('ip4-address') === '—' ? '尚未采样' : text('ip4-address'),
          activity: networkTools.filter(tool => tool.id === 'browser-network'
            ? !input('stop').disabled && doc.getElementById('connectivity')?.dataset.running !== 'true'
            : tool.id === 'connectivity' ? doc.getElementById(tool.id)?.dataset.running === 'true'
            : doc.getElementById(tool.id)?.dataset.state === 'running').map(tool => tool.id),
        };
        setSample(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
      };
      observer = new MutationObserver(read);
      observer.observe(doc.body, { childList: true, attributes: true, characterData: true, subtree: true });
      // The parent owns configuration-operation lockout; it is never bypassed.
      const parentObserver = new MutationObserver(read);
      parentObserver.observe(frame, { attributes: true, attributeFilter: ['inert'] });
      doc.addEventListener('change', read);
      detach = () => { doc.removeEventListener('change', read); parentObserver.disconnect(); };
      read();
    };
    frame.addEventListener('load', attach); attach();
    return () => { frame.removeEventListener('load', attach); observer?.disconnect(); detach(); };
  }, []);
  return sample;
}

function App() {
  const [page, setPage] = useState(pageFromHash);
  const [tool, setTool] = useState(() => networkToolFromHash(location.hash));
  const [open, setOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [local, setLocal] = useState({ host: '正在读取', protection: '等待本机检查', dev: '连接开发服务…' });
  const sample = useSample();
  useEffect(() => {
    const change = () => flushSync(() => { setPage(pageFromHash()); setTool(networkToolFromHash(location.hash)); setContextOpen(false); });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextOpen(false); };
    addEventListener('hashchange', change);
    addEventListener('keydown', escape);
    const observer = new MutationObserver(() => {
      const text = (id: string) => document.getElementById(id)?.textContent ?? '';
      const next = { host: text('host-status'), protection: text('system-status'), dev: text('dev-state') };
      setLocal(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    });
    for (const id of ['host-status', 'system-status', 'dev-state']) {
      const element = document.getElementById(id);
      if (element) observer.observe(element, { childList: true, characterData: true, subtree: true, attributes: true });
    }
    return () => { removeEventListener('hashchange', change); removeEventListener('keydown', escape); observer.disconnect(); };
  }, []);
  useEffect(() => {
    document.body.dataset.sidebar = open ? 'expanded' : 'collapsed';
    document.body.dataset.context = contextOpen ? 'open' : 'closed';
    document.body.dataset.networkView = 'local-network';
  }, [open, contextOpen]);
  useEffect(() => {
    const panel = document.getElementById('context-ui')!;
    panel.inert = !contextOpen;
    panel.setAttribute('aria-hidden', String(!contextOpen));
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'context-panel-title');
    if (!contextOpen) {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement;
    panel.querySelector<HTMLButtonElement>('.context-close')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [...panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [contextOpen]);
  const frameDoc = () => (document.getElementById('network-frame') as HTMLIFrameElement).contentDocument;
  const changeOption = (index: number, checked: boolean) => {
    const doc = frameDoc();
    const input = doc?.getElementById('select-' + ['ip', 'dns', 'rtc', 'connect'][index]) as HTMLInputElement | null;
    if (!input || input.disabled || sample.running || sample.busy) return;
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return <AnimatedSidebarProvider open={open} onOpenChange={setOpen}
    style={{ '--sidebar-width': '200px', '--sidebar-width-icon': '68px', '--sidebar-width-mobile': '240px' }} className="beui-provider">
    {portal('sidebar-ui', <AnimatedSidebar ariaLabel="工作台导航" className="console-sidebar" panelClassName="console-sidebar-panel">
      <AnimatedSidebarHeader className="console-sidebar-header">
        <div className="sidebar-brand">
          <a className="sidebar-brand-mark sidebar-brand-logo" href="#network" aria-label="身后红玫瑰首页">
            <svg viewBox="333 345 1569 358" role="img" aria-label="身后红玫瑰品牌 Logo">
              <defs>
                <filter id="sidebar-brand-ink" x="0" y="0" width="2236" height="683" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                  {/* Show the source's bright ink only; suppress the dark canvas and gray duplicate without redrawing the lettering. */}
                  <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.8504 2.8608 0.2888 0 -2" result="letter-alpha"/>
                  <feFlood floodColor="currentColor" result="letter-color"/>
                  <feComposite in="letter-color" in2="letter-alpha" operator="in"/>
                </filter>
              </defs>
              <image href="/brand-logo.png" width="2236" height="683" filter="url(#sidebar-brand-ink)"/>
            </svg>
          </a>
          <strong>网络工具箱</strong><AnimatedSidebarTrigger className="sidebar-collapse" aria-label="收起或展开功能侧栏"><PanelLeftClose size={16}/></AnimatedSidebarTrigger>
        </div>
      </AnimatedSidebarHeader>
      <AnimatedSidebarContent className="console-sidebar-content">
        <AnimatedSidebarGroup>
          <AnimatedSidebarMenu>{destinations.filter(item => item.id !== 'settings').map(({ id, label, icon: Icon }) =>
            <AnimatedSidebarMenuItem key={id}><AnimatedSidebarMenuButton ariaLabel={label} icon={<Icon size={17}/>} href={'#' + id}
              isActive={page === id} className="console-menu-button"><strong>{label}</strong></AnimatedSidebarMenuButton></AnimatedSidebarMenuItem>)}</AnimatedSidebarMenu>
        </AnimatedSidebarGroup>
      </AnimatedSidebarContent>
      <AnimatedSidebarFooter className="console-sidebar-footer">
        <AnimatedSidebarMenuButton href="#settings" icon={<Settings2 size={16}/>} isActive={page === 'settings'} className="preferences-link">帮助与关于</AnimatedSidebarMenuButton>
        <Button data-beui id="support-author" variant="ghost" size="sm" className="support-sidebar" aria-label="赞赏作者" onClick={() => (document.getElementById('support-dialog') as HTMLDialogElement).showModal()}><Heart size={16}/><span className="support-control-label">赞赏作者</span></Button>
      </AnimatedSidebarFooter>
    </AnimatedSidebar>)}
    {portal('tabs-ui', <>
      <AnimatedSidebarTrigger className="mobile-menu" aria-label="打开功能菜单"><Menu size={20}/></AnimatedSidebarTrigger>
      {page === 'network' && <nav className="network-jump-links" aria-label="本页分区">{networkTools.map(({ id, label }, index) => <a key={id} href={'#' + id} aria-current={tool === id ? 'location' : undefined}><span className="network-jump-number">{String(index + 1).padStart(2, '0')}</span>{label}{sample.activity.includes(id) && <span className="workbench-tool-running">进行中</span>}</a>)}</nav>}
      {page === 'network' && <Tooltip content="选择浏览器网络检测项目" side="bottom" wrapperClassName="context-trigger-wrapper"><Button ref={contextTrigger} data-beui variant="outline" size="sm" className="context-trigger" aria-label="显示或隐藏检测选项" aria-controls="context-ui" aria-expanded={contextOpen} onClick={() => setContextOpen(!contextOpen)}><Settings2 size={16}/><span>浏览器检测项</span></Button></Tooltip>}
    </>)}
    {portal('context-ui', <>
      <div className="context-heading"><span id="context-panel-title">检测选项与状态</span><span className="live-label"><span className="tiny-dot"/>本机</span><Button data-beui className="context-close" variant="ghost" size="icon" aria-label="关闭连接面板" onClick={() => setContextOpen(false)}><X size={16}/></Button></div>
      {page === 'network' ? <>
        <section className="context-section"><h2>浏览器网络检测项目</h2><p>只控制“浏览器网络”分区的采样。</p>
          <div className="rb-probe-total"><AnimatedNumber value={sample.options.slice(0, 3).filter(Boolean).length}/><span>项检测<small>其余检测在页面各分区单独启动</small></span></div>
          <div className="context-options">{[
            ['公网 IP', 'IPv4 与 IPv6 出口', Globe2], ['DNS 解析器', '域名请求的解析来源', Network],
            ['WebRTC', '浏览器连接出口', Activity],
          ].map(([label, subtitle, Icon], index) => {
            const Symbol = Icon as typeof Globe2;
            return <div className={'context-option ' + (index === 4 ? 'geo-context' : '')} key={index}><Symbol size={16}/><span><strong>{label as string}</strong><small>{subtitle as string}</small></span>
              <Switch checked={sample.options[index]} onCheckedChange={checked => changeOption(index, checked)} ariaLabel={label as string}
                disabled={!sample.loaded || sample.running || sample.busy} className="beui-switch"/></div>;
          })}</div>
          <div className="context-privacy"><LockKeyhole size={13}/><span>点击检测后，才连接第三方检测服务。</span></div>
        </section>
        <section className="context-section"><div className="context-section-title"><h2>采样状态</h2><AnimatedBadge size="sm" status={sample.running ? 'loading' : 'neutral'} className="console-badge">{sample.running ? '检测中' : sample.elapsed === '等待开始' ? '未开始' : '已结束'}</AnimatedBadge></div>
          <div className="sample-summary"><span>{sample.overall}</span><small>{sample.elapsed}</small></div>
          <Button data-beui variant="outline" size="sm" className="context-copy" disabled={!sample.loaded || sample.copyDisabled || sample.busy} onClick={() => { const doc = frameDoc(); if (doc && !sample.busy) click('copy', doc); }}><Copy size={14}/>复制检测报告</Button>
        </section>
      </> : <section className="context-section"><h2>设备状态</h2><p>读取此设备的配置状态</p><div className="device-state"><Monitor size={20}/><div><strong>Clash Verge Rev</strong><small>{local.host}</small></div></div><div className="context-data"><span>系统 DNS</span><strong>{local.protection}</strong></div><Button data-beui variant="outline" size="sm" className="context-copy" onClick={() => { go('overview'); click('health-refresh'); }}><RotateCcw size={14}/>刷新本机状态</Button></section>}
      <details className="context-section route-section"><summary className="context-section-title"><span>理解解析路径</span><ChevronRight size={15}/></summary>
        <div className="route-map"><div><Monitor size={19}/><span>你的设备</span></div><span className="route-dashes"/><div className="route-node"><Network size={19}/><span>DNS 解析器</span></div><span className="route-dashes"/><div><Globe2 size={19}/><span>目标网络</span></div></div>
        <p>核对解析器的机构与地区，判断请求是否经过预期的网络。</p>
      </details>
      <div className="context-help"><CircleHelp size={15}/><p>结果仅代表当前浏览器与本次采样。解析器数量和 IP 不同，均不能单独证明泄漏。</p></div>
      <a className="context-source" href="/network#sources" target="_blank" rel="noopener">数据来源与检测范围 <ArrowUpRight size={12}/></a>
    </>)}
    {portal('status-ui', <><span className="status-left"><span className="tiny-dot"/>本地工作台 <span className="status-separator">/</span><LockKeyhole size={11}/>配置在本机处理</span><span className="status-right"><span>{sample.activity.length ? `${sample.activity.length} 项检测进行中` : page === 'network' ? '按需检测 · 手动启动' : '配置修改前需预览确认'}</span><span className="status-separator">·</span><span>v2.0</span><ArrowDownLeft size={11}/></span></>)}
    {contextOpen && createPortal(<button type="button" className="dashboard4-context-backdrop" tabIndex={-1} aria-label="关闭检测选项面板" onClick={() => setContextOpen(false)}/>, document.body)}
  </AnimatedSidebarProvider>;
}

// Establish the initial route before rendering the shell. Subsequent page
// visibility and body route state are updated together by workbench.js.
document.body.dataset.page = pageFromHash();
flushSync(() => createRoot(document.getElementById('beui-root')!).render(<App/>));
// Establish initial page visibility before viewport-triggered React Bits effects.
document.querySelectorAll<HTMLElement>('.page').forEach(section => { section.hidden = section.id !== 'page-' + pageFromHash(); });
installReactBits(document, 'workbench');
