import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import ClyraStudioPhone from './ClyraStudioPhone.jsx';

// The export page mounts the exact same preview component used in the editor.
// A local frame worker advances its clock and captures the resulting DOM at 60 fps.
export default function StoryRenderHost({ id }) {
  const [spec, setSpec] = useState(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/story/render/${encodeURIComponent(id)}/spec`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Render data unavailable.');
        return body;
      })
      .then(body => { if (live) setSpec(body); })
      .catch(cause => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (!spec) return;
    window.__frameSetTextTime = async value => {
      flushSync(() => setTime(value));
      const video = document.querySelector('.csp-render-root .bgVideo');
      if (video && video.seeking) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1800);
          video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      await Promise.all([...document.querySelectorAll('.csp-render-root .storyChat img')].map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        image.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        image.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
      })));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    document.fonts.ready.then(() => { window.__frameTextReady = true; });
    return () => { delete window.__frameSetTextTime; delete window.__frameTextReady; };
  }, [spec]);

  if (error) return <p role="alert">{error}</p>;
  if (!spec) return null;
  return <ClyraStudioPhone
    renderOnly
    name={spec.name}
    messages={spec.messages}
    theme={spec.theme}
    videoUrl={spec.videoUrl}
    posterUrl={spec.posterUrl}
    background={spec.background}
    time={time}
    setTime={() => {}}
    playing={false}
    setPlaying={() => {}}
  />;
}
