import React, { useEffect, useRef, useState } from 'react';
import { mountCreatorStudio } from './clyra-source/studioEngine.js';
import studioCss from './clyra-source/studioStyles.css?inline';
import './would-you-rather-studio.css';

const STYLE_ID = 'frame-clyra-studio-styles';

export default function WouldYouRatherStudio({ go, embed = false, initial = null, onState }) {
  const host = useRef(null);
  const goRef = useRef(go);
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? { height: 720, width: 1280 } : { height: window.innerHeight, width: window.innerWidth });
  goRef.current = go;
  const stateRef = useRef(onState);
  stateRef.current = onState;
  useEffect(() => {
    const updateHeight = () => setViewport({ height: window.innerHeight, width: window.innerWidth });
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);
  useEffect(() => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = studioCss;
      document.head.appendChild(style);
    }
    const studio = mountCreatorStudio(host.current, {
      tool: 'wyr',
      css: studioCss,
      onExit: () => goRef.current('/tools'),
      embed, initial, onState: (st) => stateRef.current?.(st),
    });
    return () => studio.destroy();
  }, []);
  if (embed) return <div className="wyr-host wyr-embed" ref={host} style={{ height: viewport.height, overflow: 'hidden' }} />;
  return <div className="wyr-host" ref={host} style={viewport.width <= 700 ? { height: 'auto', overflow: 'visible' } : { height: Math.max(560, viewport.height - 96), overflow: 'hidden' }} />;
}
