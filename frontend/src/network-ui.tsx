import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Copy, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/motion/button';
import { installReactBits, SparkActions } from './reactbits-integration';
import { Connectivity } from './connectivity-ui';
import { IpQuality } from './quality-ui';
import './myip-diagnostics';
import './network-views';

// Render before diagnostics.js binds its established control IDs. Sampling and
// cancellation continue to belong to the existing diagnostics engine.
document.body.dataset.embedded = window.parent !== window ? 'true' : 'false';
flushSync(() => createRoot(document.getElementById('network-actions')!).render(<SparkActions>
  <Button data-beui id="start" className="detection-primary-action" ripple><Play size={18} fill="currentColor"/><span id="start-label">检测浏览器网络</span></Button>
  <div className="network-secondary-actions">
    <Button data-beui id="stop" className="detection-stop-action" variant="ghost" size="sm" disabled><Square size={14}/>停止</Button>
    <Button data-beui id="copy" variant="outline" size="sm" disabled><Copy size={14}/><span id="copy-label">复制报告</span></Button>
    <Button data-beui id="clear" variant="ghost" size="sm"><RotateCcw size={14}/>清空</Button>
  </div>
</SparkActions>));
for (const [section, label] of [['dns', '检测 DNS'], ['rtc', '检测 WebRTC']] as const) {
  // Render this control once. diagnostics.js owns its label, running state,
  // disabled state and click behavior for independent section sampling.
  flushSync(() => createRoot(document.getElementById(`${section}-actions`)!).render(
    <Button data-beui id={`${section}-run`} variant="outline" size="sm" className="section-run" aria-label={label} data-running="false">
      <Play size={14} className="section-run-play" aria-hidden="true"/>
      <Square size={14} className="section-run-stop" aria-hidden="true"/>
      <span id={`${section}-run-label`}>{label}</span>
    </Button>,
  ));
}
flushSync(() => createRoot(document.getElementById('connectivity-root')!).render(<Connectivity/>));
flushSync(() => createRoot(document.getElementById('quality-root')!).render(<IpQuality/>));
installReactBits(document, 'network');
