import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/motion/button';
import { discoverProxyPorts, type LocalProxyPorts } from './quality-api';

export function ProxyPortPicker({ value, onChange, disabled }: { value: string; onChange: (port: string) => void; disabled: boolean }) {
  const [ports, setPorts] = useState<LocalProxyPorts>({ candidates: [], notes: [] });
  const [loading, setLoading] = useState(true), [manual, setManual] = useState(false), [error, setError] = useState('');
  const revision = useRef(0), currentValue = useRef(value), change = useRef(onChange), manualChoice = useRef(false);
  currentValue.current = value; change.current = onChange;
  async function refresh() {
    const request = ++revision.current;
    setLoading(true); setError('');
    try {
      const result = await discoverProxyPorts();
      if (request !== revision.current) return;
      setPorts(result);
      if (result.candidates.length && !manualChoice.current) setManual(false);
      if (!currentValue.current && !manualChoice.current && result.candidates.length === 1) change.current(String(result.candidates[0].port));
      if (!result.candidates.length) setManual(true);
    } catch {
      if (request !== revision.current) return;
      setManual(true); setError('未能读取候选端口，请手动填写，或稍后重新识别。');
    } finally { if (request === revision.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, []);
  const known = ports.candidates.some(candidate => String(candidate.port) === value);
  const selection = manual || value && !known ? 'manual' : value;
  const active = ports.candidates.find(candidate => String(candidate.port) === value);
  return <div className="quality-proxy-picker">
    <div className="quality-proxy-picker-controls">
      {ports.candidates.length > 0 && <label><span>代理端口</span><select aria-label="检测代理端口" value={selection} disabled={disabled || loading} onChange={event => {
        manualChoice.current = true;
        setManual(event.target.value === 'manual');
        if (event.target.value !== 'manual') onChange(event.target.value);
      }}><option value="" disabled>发现 {ports.candidates.length} 个端口，请选择</option>{ports.candidates.map(candidate => <option key={candidate.port} value={candidate.port}>{candidate.port} · {candidate.sources.join(' / ')}</option>)}<option value="manual">手动填写其他端口</option></select></label>}
      {(manual || value && !known) && <label className="quality-port"><span>端口</span><input aria-label="本机 HTTP 代理端口" inputMode="numeric" placeholder="HTTP / 混合端口" value={value} disabled={disabled} onChange={event => { manualChoice.current = true; onChange(event.target.value); }}/></label>}
      <Button data-beui variant="outline" size="sm" disabled={disabled || loading} onClick={() => void refresh()}><RotateCcw size={14}/>{loading ? '正在识别端口…' : '重新识别'}</Button>
    </div>
    <p className="quality-proxy-hint" role="status">{error || (loading ? '正在读取已有代理设置与本机监听列表…' : ports.candidates.length === 0 ? '未找到配置明确且正在监听的 HTTP / 混合端口，请手动填写。' : !value ? '有多个候选端口，请选择本次检测使用的端口。' : active ? `已选择 ${value} · ${active.sources.join(' / ')}${active.loopbackOnly ? ' · 仅本机回环监听' : ''}` : '使用手动填写的 HTTP / 混合端口。')}</p>
    {!loading && ports.notes.map(note => <p key={note} className="quality-proxy-hint">{note}</p>)}
  </div>;
}
