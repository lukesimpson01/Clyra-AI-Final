import React, { useEffect, useRef } from 'react';
import { mountCreatorStudio } from './clyra-source/studioEngine.js';

export default function WyrRenderHost({ id }) {
  const studioHost = useRef(null);
  const canvas = useRef(null);

  useEffect(() => {
    let active = true;
    let studio;
    window.__frameWyrReady = false;
    const start = async () => {
      const response = await fetch(`/api/wyr/render/${id}/spec`);
      if (!response.ok) throw new Error('The choice-video render could not load.');
      const spec = await response.json();
      if (!active) return;
      studio = mountCreatorStudio(studioHost.current, { tool: 'wyr' });
      await studio.wyrPicturesReady(spec);
      window.__frameSetWyrTime = time => studio.renderWyrFrame(canvas.current, spec, time);
      window.__frameSetWyrTime(0);
      window.__frameWyrReady = true;
    };
    void start().catch(error => { window.__frameWyrError = error.message; });
    return () => { active = false; studio?.destroy(); delete window.__frameSetWyrTime; delete window.__frameWyrReady; };
  }, [id]);

  return <div style={{ width: 720, height: 1280, margin: 0, overflow: 'hidden' }}><canvas id="frame-wyr-canvas" ref={canvas} width="720" height="1280" style={{ display: 'block', width: 720, height: 1280 }} /><div ref={studioHost} style={{ display: 'none' }} /></div>;
}
