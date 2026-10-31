import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

/* Open the shared advanced editor in place, with a quiet loading state and a restrained fade. */
export default function AdvancedStudioGate({ go, name }) {
  const [state, setState] = useState({ phase: 'starting', error: '' });
  const [slow, setSlow] = useState(false);
  const [url, setUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const pending=React.useRef(null);
  const start = () => {
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;
    setState({ phase: 'starting', error: '' });
    setLoaded(false);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 900);
    controller.signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
    fetch('/api/advanced/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),signal:controller.signal })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Could not start the editor.'); return body; })
      .then(({ url }) => { clearTimeout(timer); setState({ phase: 'opening', error: '' }); setUrl(url); })
      .catch((e) => { clearTimeout(timer); if(!controller.signal.aborted)setState({ phase: 'failed', error: e.message }); });
  };
  useEffect(()=>{start();return()=>pending.current?.abort();}, []);
  return (
    <div style={{ position:'fixed', inset:0, zIndex:60, background:'#fcfcfc', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <style>{`@keyframes gate-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }.advanced-surface{position:absolute;inset:0;width:100%;height:100%;border:0;transition:opacity 360ms cubic-bezier(.22,1,.36,1)}@media(prefers-reduced-motion:reduce){.advanced-surface{transition:none!important}}`}</style>
      {url && <iframe className="advanced-surface" title="Advanced editor" src={url} allow="autoplay; clipboard-read; clipboard-write; fullscreen" style={{opacity:loaded?1:0}} onLoad={()=>setLoaded(true)}/>}
      {state.phase === 'failed' ? (
        <div style={{ maxWidth: 460, animation: 'gate-in .24s cubic-bezier(.22,1,.36,1) both' }}>
          <h2>The advanced editor didn’t start</h2>
          <p>{state.error}</p>
          <button className="primary" onClick={start}>Try again</button>{' '}
          <button className="secondary" onClick={() => go('/editor/classic')}>Use the classic editor <ArrowUpRight size={15} /></button>
        </div>
      ) : slow && !loaded ? (
        <p style={{ margin: 0, color: '#8f8f8f', fontSize: 14, animation: 'gate-in .3s cubic-bezier(.22,1,.36,1) both' }}>Starting the editor for the first time…</p>
      ) : null}
    </div>
  );
}
