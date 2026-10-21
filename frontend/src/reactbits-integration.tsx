import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SpotlightCard from '@/components/reactbits/SpotlightCard/SpotlightCard';
import AnimatedContent from '@/components/reactbits/AnimatedContent/AnimatedContent';
import BlurText from '@/components/reactbits/BlurText/BlurText';
import CountUp from '@/components/reactbits/CountUp/CountUp';
import ClickSpark from '@/components/reactbits/ClickSpark/ClickSpark';

export function useMotionPreference() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function BrandGradient({ children }: { children: ReactNode }) {
  // The Refero design requires flat ink typography, with no gradient fills.
  return <span className="rb-brand-gradient">{children}</span>;
}

export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useMotionPreference();
  return <span data-rb-component="CountUp" className={className}>{reduced ? value : <CountUp to={value} duration={0.65}/>}</span>;
}

export function SparkActions({ children }: { children: ReactNode }) {
  const reduced = useMotionPreference();
  const content = <div className="rb-spark-content">{children}</div>;
  return <div data-rb-component="ClickSpark" className="rb-spark-actions">{reduced ? content :
    <ClickSpark sparkColor="#f0d7ff" sparkSize={7} sparkRadius={22} sparkCount={8} duration={450}>{content}</ClickSpark>}
  </div>;
}

// Preserve the real DOM nodes, IDs and event handlers owned by the established
// diagnostic/configuration engine. React owns the visual wrappers, not the data.
function NativeContent({ nodes }: { nodes: Node[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.append(...nodes); }, [nodes]);
  return <div ref={ref} className="rb-native-content"/>;
}

function NativeSparks({ nodes }: { nodes: Node[] }) {
  return <SparkActions><NativeContent nodes={nodes}/></SparkActions>;
}

function Surface({ nodes, flat = false }: { nodes: Node[]; flat?: boolean }) {
  const reduced = useMotionPreference();
  const ref = useRef<HTMLDivElement>(null);
  const complete = useCallback(() => ref.current?.setAttribute('data-enter-state', 'done'), []);
  const content = flat ? <NativeContent nodes={nodes}/> : <SpotlightCard className="rb-card-surface" spotlightColor="rgba(240, 215, 255, 0)"><NativeContent nodes={nodes}/></SpotlightCard>;
  return <div ref={ref} data-rb-component={flat ? 'AnimatedContent' : 'AnimatedContent SpotlightCard'} data-enter-state={reduced ? 'done' : 'pending'} className="rb-surface-motion">{reduced ? content :
    <AnimatedContent distance={18} duration={0.55} initialOpacity={0.15} threshold={0.02} onComplete={complete} className="rb-enter">{content}</AnimatedContent>}
  </div>;
}

function Heading({ text }: { text: string }) {
  const reduced = useMotionPreference();
  const ref = useRef<HTMLDivElement>(null);
  const complete = useCallback(() => ref.current?.setAttribute('data-text-ready', 'true'), []);
  return <div ref={ref} data-rb-component="BlurText" data-text-ready={reduced ? 'true' : 'false'}>{reduced ? <p>{text}</p> : <BlurText text={text} animateBy="letters" delay={23} direction="bottom" stepDuration={0.22} onAnimationComplete={complete}
    animationFrom={{ filter: 'blur(8px)', opacity: 0, y: 14 }} animationTo={[{ filter: 'blur(3px)', opacity: 0.6, y: -2 }, { filter: 'blur(0px)', opacity: 1, y: 0 }]}/>}</div>;
}

function ResolverCount({ source }: { source: HTMLElement }) {
  const read = () => /^\d+/.exec(source.textContent ?? '')?.[0];
  const [value, setValue] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setValue(read()));
    observer.observe(source, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [source]);
  return <p className="rb-resolver-number">{value ? <AnimatedNumber value={Number(value)}/> : <span>—</span>}<span>个解析器</span></p>;
}

export function installReactBits(document: Document, mode: 'workbench' | 'network') {
  document.body.classList.add('reactbits-ui');
  const roots = new Map<HTMLElement, Root>();
  const mount = (element: HTMLElement, content: ReactNode) => {
    const root = createRoot(element); roots.set(element, root);
    flushSync(() => root.render(content));
  };
  for (const element of document.querySelectorAll<HTMLElement>('.hero h1, .page-heading h1')) {
    const text = element.textContent ?? '';
    const heading = document.createElement('div');
    heading.className = 'rb-heading'; heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '1');
    element.replaceWith(heading); mount(heading, <Heading text={text}/>);
  }
  if (mode === 'network') {
    const source = document.getElementById('dns-overview-count')!;
    source.classList.add('rb-count-source'); source.setAttribute('aria-hidden', 'true');
    const target = document.createElement('div'); target.className = 'rb-count-host'; source.after(target);
    mount(target, <ResolverCount source={source}/>);
  }
  const enhance = () => {
    for (const [element, root] of roots) if (!element.isConnected) { root.unmount(); roots.delete(element); }
    const selector = mode === 'network' ? '.ip-card, .dns-card, .rtc-card' : '.card:not(.preview-card), .coverage-card, .protection-hero, dialog';
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.dataset.rbSurface || !element.childNodes.length) continue;
      element.dataset.rbSurface = mode === 'network' ? 'AnimatedContent' : 'SpotlightCard'; element.classList.add('rb-surface-host');
      mount(element, <Surface flat={mode === 'network'} nodes={Array.from(element.childNodes)}/>);
    }
    if (mode === 'workbench') for (const element of document.querySelectorAll<HTMLElement>('.protection-cta, .option-footer, .review-actions, .row-actions')) {
      if (element.dataset.rbSpark || !element.childNodes.length) continue;
      element.dataset.rbSpark = 'ClickSpark';
      mount(element, <NativeSparks nodes={Array.from(element.childNodes)}/>);
    }
  };
  enhance();
  let pending = false;
  const observer = new MutationObserver(records => {
    if (pending) return; pending = true;
    const visibilityChanged = records.some(record => record.type === 'attributes');
    requestAnimationFrame(() => { pending = false; enhance(); if (visibilityChanged) ScrollTrigger.refresh(); });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
  addEventListener('hashchange', () => requestAnimationFrame(() => ScrollTrigger.refresh()));
  addEventListener('pagehide', () => { observer.disconnect(); for (const root of roots.values()) root.unmount(); }, { once: true });
}
