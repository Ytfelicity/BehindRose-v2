import { networkToolFromHash, networkTools } from './network-tools';

// Switch presentation only. Mounted detectors retain their task and results.
function showView(hash: string) {
  const tool = networkToolFromHash(hash);
  document.body.dataset.networkView = 'local-network';
  document.querySelectorAll<HTMLAnchorElement>('.network-section-links a').forEach(link => {
    if (link.hash === '#' + tool) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  document.title = '网络检测 · 身后红玫瑰';
}
showView(location.hash);
window.addEventListener('network-view', event => {
  const detail = (event as CustomEvent).detail;
  if (typeof detail === 'string') showView(detail);
});
window.addEventListener('hashchange', () => {
  if (window.parent === window && networkTools.some(tool => '#' + tool.id === location.hash)) {
    showView(location.hash);
    requestAnimationFrame(() => document.getElementById(networkToolFromHash(location.hash))?.scrollIntoView());
  }
});
