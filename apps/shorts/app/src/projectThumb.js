/* A project's card picture, the way the advanced editor's projects menu shows one: a frame of the finished video.
   A tool says a video is done with announceProject(); the app (main.jsx) makes the project and its thumbnail. */
const W = 270, H = 480;

/** Tell the app a tool finished a video. `source`: the video's URL, its Blob, or a playing <video> element. */
export function announceProject({ name, tool = location.pathname, source }) {
  window.dispatchEvent(new CustomEvent('shorts-project', { detail: { name, tool, source } }));
}

/** A small 9:16 JPEG (data URL) of the video at `at` seconds (or the element's current frame), or null. */
export async function captureThumb(source, at = 1) {
  try {
    let video = source instanceof HTMLVideoElement ? source : null, url = null;
    if (!video) {
      url = source instanceof Blob ? URL.createObjectURL(source) : String(source || '');
      if (!url) return null;
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous'; video.src = url;
      await new Promise((done, fail) => { video.addEventListener('loadeddata', done, { once: true }); video.addEventListener('error', fail, { once: true }); setTimeout(fail, 8000); });
      const d = Number.isFinite(video.duration) ? video.duration : at;
      await new Promise((done) => { video.addEventListener('seeked', done, { once: true }); video.currentTime = Math.min(at, Math.max(0, d / 2)); setTimeout(done, 3000); });
    }
    if (video.readyState < 2) return null;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const vw = video.videoWidth || W, vh = video.videoHeight || H, s = Math.max(W / vw, H / vh);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.drawImage(video, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    const out = c.toDataURL('image/jpeg', 0.78);
    if (url && source instanceof Blob) URL.revokeObjectURL(url);
    return out;
  } catch {
    return null;
  }
}
