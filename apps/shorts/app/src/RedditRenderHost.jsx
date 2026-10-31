import React, { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import RedditLivePreview from './RedditLivePreview.jsx';

// The Reddit MP4 export page: the same preview the tool shows, driven frame by frame by the local render worker.
export default function RedditRenderHost({ id }) {
  const [spec, setSpec] = useState(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/reddit/render/${encodeURIComponent(id)}/spec`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Render data unavailable.'); return body; })
      .then((body) => { if (live) setSpec(body); })
      .catch((cause) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (!spec) return;
    window.__frameSetRedditTime = async (value) => {
      flushSync(() => setTime(value));
      const video = document.querySelector('.rlp-game');
      if (video && video.seeking) {
        await new Promise((resolve) => { const timer = setTimeout(resolve, 1800); video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true }); });
      }
      await Promise.all([...document.querySelectorAll('.rlp-post img')].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        image.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        image.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
      })));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const video = document.querySelector('.rlp-game');
    const loaded = !video || video.readyState >= 2 ? Promise.resolve() : new Promise((resolve) => { video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 8000); });
    Promise.all([document.fonts.ready, loaded]).then(() => { window.__frameRedditReady = true; });
    return () => { delete window.__frameSetRedditTime; delete window.__frameRedditReady; };
  }, [spec]);

  if (error) return <p role="alert">{error}</p>;
  if (!spec) return null;
  return <div style={{ margin: 0, width: 256, height: 455, overflow: 'hidden' }}><RedditLivePreview renderOnly time={time} posts={spec.posts} dark={spec.dark} videoUrl={spec.videoUrl} posterUrl={spec.posterUrl} /></div>;
}
