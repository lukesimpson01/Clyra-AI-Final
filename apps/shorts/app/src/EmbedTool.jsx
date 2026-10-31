import React, { useCallback, useEffect, useRef, useState } from 'react';
import AutoClipStudio from './AutoClipStudio.jsx';
import AutoClipSourcePage from './AutoClipSourcePage.jsx';
import FakeTextWorkspace from './FakeTextWorkspace.jsx';
import StoryWizard from './StoryWizard.jsx';
import WouldYouRatherStudio from './WouldYouRatherStudio.jsx';
import './embed-tool.css';

/* /embed/<tool>: a story tool's own menu, inside the advanced editor's sidebar. The editor sends the story to start
   from ({ type: 'shorts-embed-init', state }) and gets every change back ({ type: 'shorts-embed-change', state }).
   The tool is the same component as on its own page; only its preview is left out and its step bar sits on top. */
/* The embedded tool lays out natively at the sidebar width; the message list takes the remaining height. */
function useFitZoom() {
  useEffect(() => {
    const fit = () => {
      const z = 1;
      document.documentElement.style.zoom = String(z);
      document.documentElement.style.setProperty('--embed-zoom', String(z));
      /* lengths inside a zoomed page are scaled by the zoom, viewport units are not reliable there: the page's height in px */
      document.documentElement.style.setProperty('--embed-h', `${window.innerHeight / z}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); document.documentElement.style.zoom = ''; };
  }, []);
}

export default function EmbedTool({ tool }) {
  useFitZoom();
  const [initial, setInitial] = useState(undefined);
  const last = useRef('');
  useEffect(() => {
    const onMessage = (e) => { if(e.source!==window.parent)return;if (e.data?.type === 'shorts-embed-init') setInitial(e.data.state ?? null);if(['shorts-embed-init','shorts-embed-theme'].includes(e.data?.type)&&['light','dark'].includes(e.data.theme))document.documentElement.dataset.uiTheme=e.data.theme; };
    window.addEventListener('message', onMessage);
    /* opened on its own (not in the editor): start from the tool's defaults */
    if (window.parent === window) setInitial(null);
    else window.parent.postMessage({ type: 'shorts-embed-ready', tool }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [tool]);
  const onState = useCallback((state) => {
    const json = JSON.stringify(state);
    if (json === last.current) return;
    last.current = json;
    window.parent?.postMessage({ type: 'shorts-embed-change', tool, state }, '*');
  }, [tool]);
  if (initial === undefined) return <div className="embed-root embed-wait" />;
  return (
    <div className={`embed-root embed-${tool}`}>
      {tool === 'text-video' && <FakeTextWorkspace embed initial={initial} onState={onState} />}
      {tool === 'reddit-video' && <StoryWizard kind="reddit" embed initial={initial} onState={onState} />}
      {tool === 'would-you-rather' && <WouldYouRatherStudio embed initial={initial} onState={onState} />}
      {tool === 'auto-clip' && <EmbedAutoClip tool={tool} />}
    </div>
  );
}

/* AutoClip in the editor's Tools tab: the home tool's source page and clip settings, as they are. "Polish and
   export" hands the source video to the editor, which puts it on the Video line (a YouTube link stays a link: nothing
   is downloaded from YouTube). */
function EmbedAutoClip({ tool }) {
  const [file, setFile] = useState(null);
  const send = () => window.parent?.postMessage({ type: 'shorts-embed-media', tool, file: file instanceof File ? file : null, link: file?.type === 'youtube-link' ? file.url : null }, '*');
  return file ? <AutoClipStudio source={file} onBack={() => setFile(null)} onEditor={send} /> : <AutoClipSourcePage onFile={setFile} />;
}
