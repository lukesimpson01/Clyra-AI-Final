/* Clyra agent bridge.

   Loaded by Clyra's own apps (Shorts, Notes) so the Clyra agent can operate one while it is embedded in Clyra: it lists
   what a person could click or type into, performs one action at a time, and reports where its pointer went. It answers
   only its embedding parent window and does nothing when the app runs on its own. */
(() => {
  if (window.top === window || window.__clyraAgentBridge) return;
  window.__clyraAgentBridge = true;

  const INTERACTIVE = 'a[href],button,input,textarea,select,summary,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="radio"],[role="checkbox"],[role="switch"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  let known = new Map();

  const shown = (el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 3 && r.height > 3 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && !el.closest('[aria-hidden="true"],[inert],[hidden]');
  };
  const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.getAttribute('alt') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const centre = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };

  /** What is on screen and operable, numbered, plus the visible text for context. */
  function snapshot() {
    known = new Map();
    const elements = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (elements.length >= 90) break;
      if (el.disabled || !shown(el)) continue;
      const i = elements.length + 1; known.set(i, el);
      const c = centre(el), tag = el.tagName.toLowerCase();
      elements.push({
        i, tag, role: el.getAttribute('role') || el.type || '', text: nameOf(el),
        ...(('value' in el && el.type !== 'file' && tag !== 'button') ? { value: String(el.value).slice(0, 70) } : {}),
        ...(el.checked !== undefined && (el.type === 'checkbox' || el.type === 'radio') ? { checked: el.checked } : {}),
        ...(el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || el.getAttribute('aria-selected') ? { state: el.getAttribute('aria-pressed') || el.getAttribute('aria-checked') || el.getAttribute('aria-selected') } : {}),
        x: c.x, y: c.y,
      });
    }
    return { title: document.title, path: location.pathname, size: { w: innerWidth, h: innerHeight }, elements, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1400) };
  }

  const target = (i) => { const el = known.get(Number(i)); if (!el || !el.isConnected) throw new Error(`Element ${i} is no longer on the page`); return el; };
  const mouse = (el, type, c) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: c.x, clientY: c.y }));

  function click(i) {
    const el = target(i); el.scrollIntoView({ block: 'center', inline: 'center' });
    const c = centre(el);
    for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown']) mouse(el, t, c);
    el.focus?.({ preventScroll: true });
    for (const t of ['pointerup', 'mouseup']) mouse(el, t, c);
    el.click();
    return { cursor: { ...c, kind: 'click' } };
  }
  function type(i, text, submit) {
    const el = target(i); el.scrollIntoView({ block: 'center' }); el.focus?.({ preventScroll: true });
    if (el.isContentEditable) { document.execCommand('selectAll'); document.execCommand('insertText', false, String(text)); }
    else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(text));
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (submit) press('Enter', el);
    return { cursor: { ...centre(el), kind: 'type' } };
  }
  function press(key, el) {
    const t = el || document.activeElement || document.body;
    const opts = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true };
    const down = t.dispatchEvent(new KeyboardEvent('keydown', opts));
    t.dispatchEvent(new KeyboardEvent('keypress', opts));
    t.dispatchEvent(new KeyboardEvent('keyup', opts));
    /* a synthetic Enter does not submit a native form on its own */
    if (key === 'Enter' && down && t.tagName === 'INPUT' && t.form) t.form.requestSubmit?.();
    return {};
  }
  function choose(i, value) {
    const el = target(i);
    if (el.tagName === 'SELECT') {
      const option = [...el.options].find((o) => o.value === value || o.textContent.trim() === value);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, option ? option.value : value);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    } else click(i);
    return { cursor: { ...centre(el), kind: 'click' } };
  }
  function scroll(dy) {
    const candidates = [document.scrollingElement, ...document.querySelectorAll('main, .page, .page-scroll, [class*="scroll"], [class*="panel-body"]')]
      .filter((e) => e && e.scrollHeight > e.clientHeight + 8).sort((a, b) => b.clientHeight - a.clientHeight);
    (candidates[0] || document.scrollingElement).scrollBy({ top: Number(dy) || 400, behavior: 'smooth' });
    return {};
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (!m || m.clyra !== 'agent') return;
    let reply;
    try {
      switch (m.op) {
        case 'ping': reply = { ready: true }; break;
        case 'snapshot': reply = { snapshot: snapshot() }; break;
        case 'click': reply = click(m.i); break;
        case 'type': reply = type(m.i, m.text, m.submit); break;
        case 'press': reply = press(String(m.key || 'Enter')); break;
        case 'select': reply = choose(m.i, m.value); break;
        case 'scroll': reply = scroll(m.dy); break;
        default: throw new Error(`Unknown action ${m.op}`);
      }
      window.parent.postMessage({ clyra: 'agent-reply', id: m.id, ok: true, ...reply }, '*');
    } catch (error) {
      window.parent.postMessage({ clyra: 'agent-reply', id: m.id, ok: false, error: error instanceof Error ? error.message : String(error) }, '*');
    }
  });
})();
