import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './clyra-source/studioStyles.css';
import './clyra-studio-phone.css';

// The live Clyra Shorts tool uses studioEngine.ts, not FakeTextScene.tsx.
// Its actual phone markup, reconciliation, timing, and CSS are retained here.
const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs><symbol id="chev-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol><symbol id="video" viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></symbol><symbol id="phone-call" viewBox="0 0 24 24"><path d="M6 3h4l1 5-2 2a17 17 0 0 0 5 5l2-2 5 1v4a3 3 0 0 1-3 3A16 16 0 0 1 3 6a3 3 0 0 1-3 3Z"/></symbol><symbol id="play" viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/></symbol><symbol id="pause" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></symbol><symbol id="full" viewBox="0 0 24 24"><path d="M9 3H3v6m18 0V3h-6M3 15v6h6m6 0h6v-6"/></symbol></defs></svg>`;
const icons = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const displayDuration = n => { n = Math.round(n); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const getMessageSeconds = msg => Math.max(msg.imageUrl ? 2.2 : 1.15, Math.min(7, (msg.text?.length || 0) / 15 + .75));
export function messageTimeline(messages) {
  const lines = messages.filter(m => m.text?.trim() || m.imageUrl); let at = .35;
  const cues = lines.map(m => { const appearAt = at * 1000; at += getMessageSeconds(m) + .45; return { appearAt, end: at * 1000 }; });
  return { cues, duration: Math.max(1, lines.reduce((a, m) => a + getMessageSeconds(m) + .45, 0)) * 1000 };
}
const textIndexAt = (seconds, lines) => { let at = .35, num = 0; for (const m of lines) { if (seconds + 1e-5 < at) break; num++; at += getMessageSeconds(m) + .45; } return num; };
/* how long a full page takes to clear before the chat goes on from the top */
const CLEAR_MS = 260;
const fitChat = (card, chat, head, target) => { chat.style.marginTop = -Math.max(0, head + chat.scrollHeight - target) + 'px'; };

export default function ClyraStudioPhone({ name, messages, theme, videoUrl, posterUrl, background, time, setTime, playing, setPlaying, renderOnly = false }) {
  const phoneRef = useRef(null), blurRef = useRef(null), resetRef = useRef(true), clockRef = useRef({ time, playing });
  const [expanded, setExpanded] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  const pagesRef = useRef({ key: '', starts: [0] });
  clockRef.current = { time, playing };
  const lines = messages.filter(m => m.text?.trim() || m.imageUrl).map(m => ({ ...m, from: m.side === 'right' ? 'sender' : 'receiver' }));
  const timeline = messageTimeline(messages), duration = timeline.duration, currentElapsed = Math.min(time / 1000, duration / 1000), playIndex = textIndexAt(currentElapsed, lines);
  const skin = typeof theme === 'string' ? theme : ({ 'imessage-light': 'ios-light', 'imessage-dark': 'ios-dark', 'whatsapp-light': 'whatsapp-light', 'whatsapp-dark': 'whatsapp-dark' }[theme?.style] || 'ios-dark');
  const profileName = () => name.trim() || 'Unknown', wa = skin.startsWith('whatsapp');
  const mediaStyle = `transform:translate(${background.offsetX}%,${background.offsetY}%) scale(${background.zoom / 100});filter:brightness(${1 - background.dim / 100}) blur(${background.blur}px);`;
  function waHeader() { return `<div class="waBar"><span class="waBack">${icons('chev-left')}</span><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="waContact"><div class="waName">${escapeHtml(profileName())}</div><div class="waStatus">online</div></div><span class="waHeaderIcons">${icons('video')}${icons('phone-call')}</span></div>`; }
  function iosHeader() { return `<div class="iosbar"><div class="backBadge">${icons('chev-left', 'sm')}<span class="badge99">99</span></div><div class="contactMini"><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="contactName">${escapeHtml(profileName())}<span class="contactChevron">›</span></div></div>${icons('video', 'sm')}</div>`; }
  function messageContent(message, index) { return `${message.imageUrl ? `<img src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(message.imageName || 'Message image')}"/>` : ''}<span class="messageCopy">${escapeHtml(message.text || '')}</span>${wa ? `<span class="waMeta"><span>10:${String(40 + index).padStart(2, '0')}</span>${message.from === 'sender' ? '<span class="waTicks" aria-label="Read"></span>' : ''}</span>` : ''}`; }
  function phoneMarkup() {
    const content = lines.slice(0, playIndex).map((m, i) => `<div class="bubbleLine ${m.from === 'sender' ? 'from-sender' : ''}" data-message-id="${escapeHtml(m.id)}"><div class="bubble ${m.imageUrl ? 'has-image' : ''}">${messageContent(m, i)}</div></div>`).join('');
    const bgv = videoUrl ? `<video class="bgVideo" src="${escapeHtml(videoUrl)}" poster="${escapeHtml(posterUrl || '')}" style="${mediaStyle}" muted loop playsinline preload="auto"></video>` : '';
    return `${bgv}<div class="storyChat" id="storyChat">${wa ? waHeader() : iosHeader()}<div class="chatMessages" id="chatMessages">${content}</div></div><div class="playerControls"><button class="playButton" data-control="play" title="${playing ? 'Pause' : 'Play'} preview" aria-label="${playing ? 'Pause' : 'Play'} preview">${icons(playing ? 'pause' : 'play', 'lg')}</button><span class="timeStamp" id="timeStamp">${displayDuration(currentElapsed)} / ${displayDuration(duration / 1000)}</span><button class="playButton fullScreen" data-control="full" title="Enlarge preview" aria-label="Enlarge preview">${icons('full', 'lg')}</button><div class="rangeTrack"><div class="rangeFill" id="rangeFill" style="width:${duration ? time / duration * 100 : 0}%"></div><input type="range" class="transportSeek" data-text-seek min="0" max="${duration / 1000}" step="0.01" value="${currentElapsed}" aria-label="Scrub text story timeline"></div></div>`;
  }
  useLayoutEffect(() => {
    const phone = phoneRef.current; if (!phone) return;
    const signature = [skin, videoUrl, profileName(), expanded].join('|');
    if (phone.dataset.signature !== signature || !phone.querySelector('.storyChat')) {
      phone.className = 'phone ' + (expanded ? 'full ' : '') + skin; phone.innerHTML = phoneMarkup(); phone.dataset.signature = signature; resetRef.current = true;
      phone.querySelector('[data-control="play"]').onclick = () => { const clock = clockRef.current; if (clock.time >= duration - 20) setTime(0); setPlaying(!clock.playing); };
      phone.querySelector('[data-control="full"]').onclick = () => setExpanded(value => !value);
      const seek = phone.querySelector('[data-text-seek]'); seek.addEventListener('pointerdown', () => setPlaying(false));
      seek.oninput = () => { resetRef.current = true; setPlaying(false); setTime(Number(seek.value) * 1000); };
      const sourceVideo = phone.querySelector('.bgVideo');
      if (sourceVideo) sourceVideo.onloadedmetadata = () => {
        const seconds = clockRef.current.time / 1000;
        if (Number.isFinite(sourceVideo.duration) && sourceVideo.duration > 0)
          sourceVideo.currentTime = ((background.trim || 0) + seconds * background.speed / 100) % sourceVideo.duration;
      };
    }
    const card = phone.querySelector('.storyChat'), chat = phone.querySelector('.chatMessages'); if (!card || !chat) return;
    const header = card.firstElementChild;
    /* Pages: where the next message would not fit, the chat clears (CLEAR_MS) and goes on from the top of the card,
       without the contact bar (the editor's story page does the same: frame/chat-runtime.js). Measured once per
       conversation, theme and size. */
    const scaleNow = expanded ? phone.offsetWidth / 256 : 1;
    const pageKey = [skin, scaleNow, mediaRevision, ...lines.map(m => `${m.id}|${m.from}|${m.text}|${m.imageUrl ? 1 : 0}`)].join('\u0001');
    if (pagesRef.current.key !== pageKey) {
      phone.style.setProperty('--chat-scale', String(scaleNow));
      const probe = chat.cloneNode(false); probe.removeAttribute('id');
      probe.style.cssText = 'position:absolute;left:0;right:0;top:0;visibility:hidden;pointer-events:none;margin:0';
      probe.innerHTML = lines.map((m, i) => `<div class="bubbleLine ${m.from === 'sender' ? 'from-sender' : ''}"><div class="bubble ${m.imageUrl ? 'has-image' : ''}">${messageContent(m, i)}</div></div>`).join('');
      card.appendChild(probe);
      const sizes = [...probe.children].map(n => n.offsetHeight + (Number.parseFloat(getComputedStyle(n).marginBottom) || 0));
      probe.remove();
      header.style.display = '';
      const room0 = phone.offsetHeight * .77 - header.offsetHeight, room = phone.offsetHeight * .77 - 12 * scaleNow;
      const starts = [0]; let used = 0;
      sizes.forEach((h, i) => { if (used > 0 && used + h > (starts.length === 1 ? room0 : room)) { starts.push(i); used = 0; } used += h; });
      pagesRef.current = { key: pageKey, starts };
    }
    const starts = pagesRef.current.starts, nowMs = currentElapsed * 1000;
    let page = 0;
    for (let k = starts.length - 1; k > 0; k--) if (playIndex - 1 >= starts[k]) { page = k; break; }
    const clearing = page > 0 && nowMs < timeline.cues[starts[page]].appearAt + CLEAR_MS;
    const shownPage = clearing ? page - 1 : page;
    const from = starts[shownPage] ?? 0, to = clearing ? starts[page] : playIndex;
    const appear = i => timeline.cues[i].appearAt + (page > 0 && i === starts[page] ? CLEAR_MS : 0);
    header.style.display = shownPage > 0 ? 'none' : '';
    chat.style.paddingTop = shownPage > 0 ? `${8 * scaleNow}px` : '';
    const visible = lines.slice(from, to), nodes = [...chat.querySelectorAll('.bubbleLine')];
    const changed = nodes.findIndex((node, i) => !visible[i] || String(node.dataset.messageId) !== String(visible[i].id));
    if (changed >= 0) nodes.slice(changed).forEach(node => node.remove());
    const existing = chat.querySelectorAll('.bubbleLine').length;
    for (let i = 0; i < existing; i++) { const node = chat.children[i], m = visible[i]; if (!node || !m) continue; node.classList.toggle('from-sender', m.from === 'sender'); const bubble = node.querySelector('.bubble'); const signature = `${m.text || ''}|${m.imageUrl || ''}|${m.from}`; if (bubble && node.dataset.contentSignature !== signature) { bubble.classList.toggle('has-image', !!m.imageUrl); bubble.innerHTML = messageContent(m, from + i); node.dataset.contentSignature = signature; } }
    for (let i = existing; i < visible.length; i++) {
      const m = visible[i], node = document.createElement('div'); node.className = 'bubbleLine' + (m.from === 'sender' ? ' from-sender' : ''); node.dataset.messageId = m.id;
      const bubble = document.createElement('div'); bubble.className = 'bubble' + (m.imageUrl ? ' has-image' : ''); bubble.innerHTML = messageContent(m, from + i);
      node.dataset.contentSignature = `${m.text || ''}|${m.imageUrl || ''}|${m.from}`;
      node.append(bubble); chat.append(node);
    }
    chat.querySelectorAll('img').forEach(img => { if (img.dataset.loadBound) return; img.dataset.loadBound = 'true'; if (!img.complete) img.addEventListener('load', () => setMediaRevision(value => value + 1), { once: true }); });
    const scale = expanded ? phone.offsetWidth / 256 : 1;
    phone.style.setProperty('--chat-scale', String(scale));
    const head = shownPage > 0 ? 0 : header.offsetHeight, limit = phone.offsetHeight * .77;
    const heightFor = contentHeight => Math.max(head + 8 * scale, Math.min(limit, head + contentHeight));
    const target = heightFor(chat.scrollHeight);
    const last = chat.lastElementChild, margin = last ? Number.parseFloat(getComputedStyle(last).marginBottom) || 0 : 0;
    const growing = !clearing && to > from;
    const before = growing && last ? heightFor(Math.max(0, chat.scrollHeight - last.offsetHeight - margin)) : target;
    const age = growing ? nowMs - appear(to - 1) : 1000;
    const progress = Math.max(0, Math.min(1, age / 450));
    const eased = 1 - Math.pow(1 - progress, 3);
    const visibleHeight = before + (target - before) * eased;
    card.style.transition = 'none'; card.style.height = visibleHeight + 'px';
    fitChat(card, chat, head, visibleHeight); card.dataset.visibleCount = String(playIndex);
    /* the clearing page: out and up, quickly; the next one starts at the top */
    const fade = clearing ? Math.max(0, Math.min(1, (nowMs - timeline.cues[starts[page]].appearAt) / CLEAR_MS)) : 0, fe = 1 - Math.pow(1 - fade, 3);
    card.style.opacity = clearing ? String(1 - fe) : ''; card.style.transform = clearing ? `translateY(${-10 * fe * scale}px) scale(${1 - .02 * fe})` : '';
    for (let i = 0; i < visible.length; i++) {
      const node = chat.children[i], elapsed = nowMs - appear(from + i);
      const p = clearing ? 1 : Math.max(0, Math.min(1, elapsed / 300)), easedBubble = 1 - Math.pow(1 - p, 3);
      node.style.setProperty('--bubble-o', String(p));
      node.style.setProperty('--bubble-y', `${(1 - easedBubble) * 10 * scale}px`);
      node.style.setProperty('--bubble-s', String(.98 + .02 * easedBubble));
    }
    const stamp = phone.querySelector('#timeStamp'); if (stamp) stamp.textContent = `${displayDuration(currentElapsed)} / ${displayDuration(duration / 1000)}`;
    const fill = phone.querySelector('#rangeFill'); if (fill) fill.style.width = Math.min(100, time / duration * 100) + '%';
    const seek = phone.querySelector('[data-text-seek]'); if (seek) { seek.max = String(duration / 1000); if (document.activeElement !== seek) seek.value = String(currentElapsed); }
    const button = phone.querySelector('[data-control="play"]'); if (button) { button.innerHTML = icons(playing ? 'pause' : 'play', 'lg'); button.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview'); }
    const video = phone.querySelector('.bgVideo'); if (video) {
      video.playbackRate = background.speed / 100; video.style.cssText = mediaStyle; video.muted = true;
      const desired = Number.isFinite(video.duration) && video.duration > 0
        ? ((background.trim || 0) + currentElapsed * video.playbackRate) % video.duration : 0;
      if (Number.isFinite(video.duration) && Math.abs(video.currentTime - desired) > (renderOnly ? .0005 : playing ? .5 : .05)) video.currentTime = desired;
      if (playing) { if (video.paused) void video.play().catch(() => undefined); } else if (!video.paused) video.pause();
    }
    const blurVideo = blurRef.current; if (blurVideo && video) {
      blurVideo.playbackRate = video.playbackRate;
      if (Number.isFinite(blurVideo.duration) && Math.abs(blurVideo.currentTime - video.currentTime) > .08) blurVideo.currentTime = video.currentTime;
      if (playing) { if (blurVideo.paused) void blurVideo.play().catch(() => undefined); } else if (!blurVideo.paused) blurVideo.pause();
    }
    resetRef.current = false;
  });
  useEffect(() => { if (!playing) return; let id = 0; const origin = performance.now() - time; const tick = now => { const elapsed = Math.min(duration, now - origin); setTime(elapsed); if (elapsed < duration) id = requestAnimationFrame(tick); else setPlaying(false); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); }, [playing, duration]);
  useEffect(() => { if (!expanded) return; const onKey = event => { if (event.key === 'Escape') setExpanded(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [expanded]);
  const phone = <div ref={phoneRef} className={`phone ${expanded ? 'full ' : ''}${skin}`}/>;
  return <div className={`csp-root cs-root ${renderOnly ? 'csp-render-root' : ''}`}><div dangerouslySetInnerHTML={{ __html: SPRITE }}/>{!renderOnly && <div className="csp-heading"><strong>Video Preview</strong></div>}<div className="csp-stage">{expanded ? null : phone}</div>{expanded && <div className="csp-fullshade" role="dialog" aria-label="Fullscreen text story preview">{videoUrl&&<video ref={blurRef} className="csp-side-video" src={videoUrl} poster={posterUrl||undefined} muted loop playsInline preload="auto" aria-hidden="true"/>}<button className="csp-close" type="button" onClick={() => setExpanded(false)} aria-label="Close fullscreen preview">×</button>{phone}</div>}</div>;
}
