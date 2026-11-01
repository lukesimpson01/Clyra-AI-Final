/* Page locks: the PIN boxes, the password field with its strength meter, and the dialogs that use them.
   A lock is a 6- or 8-digit PIN (one box per digit) or a password. Creating one asks twice; the form refuses to continue
   until both entries match and meet the minimum, and says exactly what is missing. The server checks all of it again. */
import { el, icon, modal, toast, clear, append } from "./dom.js";
import { api } from "./api.js";

const tickIcon = () => icon("check", 12);

/* ------------------------------------------------------------------ PIN boxes */

export function pinBoxes({ length = 6, label = "PIN", onChange, onComplete, autofocus = false } = {}) {
  const node = el("div", { class: "pin-boxes", role: "group", "aria-label": label });
  let digits = [];
  let inputs = [];
  const read = () => inputs.map((input) => input.value).join("");
  const sync = () => {
    inputs.forEach((input) => input.classList.toggle("filled", Boolean(input.value)));
    const value = read();
    onChange?.(value);
    if (value.length === inputs.length) onComplete?.(value);
  };
  const build = (count) => {
    clear(node);
    node.dataset.length = String(count);
    inputs = Array.from({ length: count }, (_, index) => {
      const input = el("input", {
        class: "pin-box", type: "password", inputmode: "numeric", pattern: "[0-9]*",
        autocomplete: index === 0 ? "one-time-code" : "off", "aria-label": `${label}, digit ${index + 1} of ${count}`,
        spellcheck: "false", autocapitalize: "off",
      });
      input.addEventListener("input", () => {
        /* Fast typing, autofill and password managers can hand over several digits at once: the first stays here, the
           rest fill the boxes after it. Typing over a filled box keeps the newest digit. */
        const typed = input.value.replace(/\D/g, "");
        const digits = typed.length > 1 && input.dataset.had ? typed.slice(-1) : typed;
        input.value = digits[0] || "";
        let last = index;
        for (const digit of digits.slice(1)) { if (last + 1 >= count) break; last += 1; inputs[last].value = digit; }
        if (digits.length) inputs[Math.min(count - 1, last + 1)].focus();
        sync();
      });
      input.addEventListener("keydown", () => { input.dataset.had = input.value ? "1" : ""; }, true);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !input.value && index > 0) { inputs[index - 1].value = ""; inputs[index - 1].focus(); sync(); event.preventDefault(); }
        else if (event.key === "ArrowLeft" && index > 0) { inputs[index - 1].focus(); event.preventDefault(); }
        else if (event.key === "ArrowRight" && index < count - 1) { inputs[index + 1].focus(); event.preventDefault(); }
      });
      input.addEventListener("paste", (event) => {
        const text = (event.clipboardData?.getData("text") || "").replace(/\D/g, "");
        if (!text) return;
        event.preventDefault();
        [...text.slice(0, count)].forEach((digit, offset) => { inputs[offset].value = digit; });
        inputs[Math.min(text.length, count) - 1]?.focus();
        sync();
      });
      input.addEventListener("focus", () => input.select());
      return input;
    });
    node.append(...inputs);
  };
  build(length);
  if (autofocus) setTimeout(() => inputs[0]?.focus(), 40);
  return {
    node,
    value: read,
    focus: () => inputs[0]?.focus(),
    clear() { inputs.forEach((input) => { input.value = ""; }); sync(); inputs[0]?.focus(); },
    setLength(count) { build(count); sync(); },
    setState(state) { node.dataset.state = state || ""; if (!state) node.classList.remove("shake"); },
    shake() { node.classList.remove("shake"); void node.offsetWidth; node.classList.add("shake"); },
  };
}

/* ------------------------------------------------------------ password + strength */

export function passwordField({ placeholder = "Password", label = "Password", onInput, autocomplete = "new-password" } = {}) {
  const input = el("input", { class: "pw-input", type: "password", placeholder, "aria-label": label, autocomplete, spellcheck: "false", autocapitalize: "off" });
  const eye = el("button", { class: "pw-eye", type: "button", "aria-label": "Show password", "aria-pressed": "false", tabindex: "-1" }, icon("eye", 16));
  const caps = el("div", { class: "pw-caps", hidden: true }, icon("alert", 12), "Caps Lock is on");
  const node = el("div", { class: "pw-field" }, el("div", { class: "pw-row" }, input, eye), caps);
  eye.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-pressed", String(show));
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
  input.addEventListener("input", () => onInput?.(input.value));
  input.addEventListener("keydown", (event) => { caps.hidden = !event.getModifierState?.("CapsLock"); });
  input.addEventListener("keyup", (event) => { caps.hidden = !event.getModifierState?.("CapsLock"); });
  input.addEventListener("blur", () => { caps.hidden = true; });
  return { node, input, value: () => input.value, focus: () => input.focus(), clear() { input.value = ""; onInput?.(""); } };
}

const COMMON = /^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|abc123|123456|111111|000000)/i;
export function passwordChecks(value) {
  return [
    { id: "len", label: "At least 8 characters", ok: value.length >= 8, required: true },
    { id: "case", label: "Upper and lowercase letters", ok: /[a-z]/.test(value) && /[A-Z]/.test(value) },
    { id: "num", label: "A number", ok: /\d/.test(value) },
    { id: "sym", label: "A symbol (such as ! ? # %)", ok: /[^A-Za-z0-9]/.test(value) },
    { id: "long", label: "12 or more characters", ok: value.length >= 12 },
  ];
}
/* 0 empty · 1 too weak · 2 weak · 3 good · 4 strong. Length matters most; obvious words and repetition cap the score. */
export function passwordScore(value) {
  if (!value) return 0;
  const checks = passwordChecks(value);
  if (!checks[0].ok) return 1;
  let score = 1 + checks.slice(1).filter((check) => check.ok).length * 0.75;
  if (COMMON.test(value) || /^(.)\1+$/.test(value) || /(?:0123|1234|2345|3456|abcd|qwer)/i.test(value)) score = Math.min(score, 2);
  if (new Set(value).size < 5) score = Math.min(score, 2);
  return Math.max(1, Math.min(4, Math.floor(score)));
}
const STRENGTH = ["", "Too weak", "Weak", "Good", "Strong"];

export function strengthMeter() {
  const bars = el("div", { class: "pw-bars", "aria-hidden": "true" }, [0, 1, 2, 3].map(() => el("span")));
  const word = el("span", { class: "pw-strength-word" });
  const list = el("ul", { class: "pw-checks", "aria-label": "Password requirements" });
  const node = el("div", { class: "pw-meter", "aria-live": "polite" }, el("div", { class: "pw-meter-head" }, bars, word), list);
  const update = (value) => {
    const score = passwordScore(value);
    node.dataset.score = String(score);
    [...bars.children].forEach((bar, index) => bar.classList.toggle("on", index < score));
    word.textContent = value ? STRENGTH[score] : "Choose a password";
    clear(list);
    for (const check of passwordChecks(value)) {
      list.append(el("li", { class: `pw-check${check.ok ? " ok" : ""}` }, el("span", { class: "pw-check-mark" }, check.ok ? tickIcon() : null), check.label));
    }
  };
  update("");
  return { node, update };
}

/* ------------------------------------------------------------------ unlock */

/* One entry control for unlocking, whichever way the page was locked. */
export function unlockForm({ kind, onSubmit, submitLabel = "Open page" }) {
  const message = el("div", { class: "lock-note", role: "status" });
  let busy = false;
  const fail = (text) => { message.textContent = text; message.classList.add("is-error"); };
  const attempt = async (value) => {
    if (busy || !value) return;
    busy = true; message.textContent = ""; message.classList.remove("is-error");
    const result = await onSubmit(value).catch(() => ({ ok: false, error: "Could not check that. Try again." }));
    busy = false;
    if (!result?.ok) { fail(result?.error || "That passcode is not right."); control.shake?.(); control.clear?.(); }
    return result;
  };
  let control;
  if (kind === "pin6" || kind === "pin8") {
    const pins = pinBoxes({ length: kind === "pin8" ? 8 : 6, label: "PIN", autofocus: true, onComplete: (value) => attempt(value) });
    control = { node: pins.node, shake: pins.shake, clear: pins.clear, focus: pins.focus };
    return { node: el("div", { class: "unlock-form" }, pins.node, message), focus: pins.focus, button: null };
  }
  const field = passwordField({ placeholder: "Password", label: "Password", autocomplete: "current-password" });
  const button = el("button", { class: "button primary", type: "button", onclick: () => attempt(field.value()) }, submitLabel);
  field.input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); attempt(field.value()); } });
  control = { node: field.node, shake() { field.node.classList.remove("shake"); void field.node.offsetWidth; field.node.classList.add("shake"); }, clear() { field.input.select(); } };
  return { node: el("div", { class: "unlock-form" }, field.node, message, button), focus: field.focus, button };
}

/* ------------------------------------------------------------------ the dialogs */

export function openLockDialog(page, { onDone } = {}) {
  let entry;
  const id = page.id;

  /* ---- unlocking a locked page ---- */
  if (page.locked) {
    const needs = page.lock_has_password;
    const form = needs
      ? unlockForm({ kind: page.lock_kind || "password", submitLabel: "Unlock", onSubmit: async (value) => {
          const result = await api.post(`/api/notes/pages/${id}/unlock`, { password: value }).catch((error) => ({ ok: false, error: error?.message }));
          if (result?.ok) { done("Page unlocked"); }
          return result;
        } })
      : null;
    const done = async (message) => { try { sessionStorage.removeItem(`clyra.notes.unlocked.${id}`); } catch { /* optional */ } entry.close("done"); await onDone?.(); toast(message); };
    const body = el("div", { class: "lock-dialog" },
      el("div", { class: "lock-hero" }, el("span", { class: "lock-hero-badge" }, icon("lock", 22))),
      el("h3", { class: "lock-title", text: needs ? "Enter your passcode" : "Unlock this page?" }),
      el("p", { class: "lock-dialog-text", text: needs ? "Unlocking lets you edit this page again." : "This page is locked without a passcode." }),
      form?.node);
    const footer = needs ? [el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel")]
      : [el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
         el("button", { class: "button primary", type: "button", onclick: async () => { const r = await api.post(`/api/notes/pages/${id}/unlock`, { password: "" }).catch(() => null); if (r?.ok) done("Page unlocked"); } }, "Unlock")];
    entry = modal({ title: "Unlock page", width: 400, body, footer });
    setTimeout(() => form?.focus?.(), 60);
    return;
  }

  /* ---- locking: choose the kind, enter it twice ---- */
  let mode = "pin6"; // pin6 | pin8 | password
  let pin = ""; let pinConfirm = ""; let pw = ""; let pwConfirm = "";
  const status = el("div", { class: "lock-match", "aria-live": "polite" });
  const lockButton = el("button", { class: "button primary", type: "button", disabled: true }, "Lock page");
  const note = el("p", { class: "lock-fineprint" }, icon("lock", 12), "Stored only as a salted hash. If you forget it, this page can’t be opened again — there is no recovery.");

  const segmented = el("div", { class: "lock-segmented", role: "tablist", "aria-label": "Passcode type" },
    el("button", { class: "lock-seg active", type: "button", role: "tab", "aria-selected": "true", "data-mode": "pin" }, icon("grid", 14), "PIN"),
    el("button", { class: "lock-seg", type: "button", role: "tab", "aria-selected": "false", "data-mode": "password" }, icon("key", 14), "Password"));
  const lengthChips = el("div", { class: "lock-lengths", role: "radiogroup", "aria-label": "PIN length" },
    el("button", { class: "lock-chip active", type: "button", role: "radio", "aria-checked": "true", "data-len": "6" }, "6 digits"),
    el("button", { class: "lock-chip", type: "button", role: "radio", "aria-checked": "false", "data-len": "8" }, "8 digits"));

  /* PIN: one row of boxes, used twice in the same spot. The first pass chooses it, the second confirms it. A miss
     shakes the row red, clears it and sends the person back to the first pass — both entries are made again. */
  let stage = 1; let first = "";
  const stepTitle = el("div", { class: "lock-step-title", text: "Choose a PIN" });
  const stepHint = el("div", { class: "lock-step-hint", text: "Use digits only. You’ll enter it once more to confirm." });
  const pips = el("div", { class: "lock-pips", "aria-hidden": "true" }, el("i", { class: "on" }), el("i"));
  const setStage = (next, title, hint) => {
    stage = next;
    [...pips.children].forEach((pip, index) => pip.classList.toggle("on", index < next));
    stepTitle.classList.remove("swap"); void stepTitle.offsetWidth; stepTitle.classList.add("swap");
    stepTitle.textContent = title; stepHint.textContent = hint;
  };
  const pinMain = pinBoxes({
    length: 6, label: "PIN", autofocus: true,
    onChange: (v) => { if (stage === 1) pin = v; else { pinConfirm = v === first ? v : ""; pinMain.setState(""); } refresh(); },
    onComplete: (value) => {
      if (stage === 1) {
        first = value; pin = value;
        setTimeout(() => { pinMain.clear(); setStage(2, "Confirm your PIN", "Enter the same PIN again."); refresh(); }, 180);
      } else if (value === first) {
        pinConfirm = value; pinMain.setState("ok"); refresh();
      } else {
        pinMain.setState("error"); pinMain.shake(); pin = ""; pinConfirm = ""; first = "";
        status.className = "lock-match bad"; status.textContent = "Those PINs didn’t match. Start again.";
        setTimeout(() => { pinMain.setState(""); pinMain.clear(); setStage(1, "Choose a PIN", "Use digits only. You’ll enter it once more to confirm."); lockButton.disabled = true; }, 650);
      }
    },
  });
  const resetPin = () => { first = ""; pin = ""; pinConfirm = ""; pinMain.setState(""); setStage(1, "Choose a PIN", "Use digits only. You’ll enter it once more to confirm."); };
  const pinView = el("div", { class: "lock-pane" },
    lengthChips, pips, stepTitle, pinMain.node, stepHint);

  const meter = strengthMeter();
  const pwMain = passwordField({ placeholder: "Choose a password", label: "New password", onInput: (v) => { pw = v; meter.update(v); refresh(); } });
  const pwAgain = passwordField({ placeholder: "Enter it again", label: "Confirm password", onInput: (v) => { pwConfirm = v; pwAgain.input.classList.remove("is-bad"); refresh(); } });
  const pwView = el("div", { class: "lock-pane", hidden: true },
    el("label", { class: "lock-label", text: "Password" }), pwMain.node, meter.node,
    el("label", { class: "lock-label", text: "Confirm password" }), pwAgain.node);

  pwMain.input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); pwAgain.focus(); } });
  pwAgain.input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); lockButton.click(); } });
  const length = () => (mode === "pin8" ? 8 : 6);
  function refresh() {
    let ready = false; let text = ""; let tone = "";
    if (mode === "password") {
      const long = passwordChecks(pw)[0].ok;
      if (!pw) text = "";
      else if (!long) { text = "Use at least 8 characters."; tone = "bad"; }
      else if (!pwConfirm) text = "Enter it once more to confirm.";
      else if (pw === pwConfirm) { text = "Passwords match."; tone = "ok"; }
      ready = long && Boolean(pwConfirm);
      pwAgain.input.classList.toggle("is-ok", tone === "ok" && pw === pwConfirm);
    } else {
      if (stage === 1) text = pin.length ? `${length() - pin.length} more digit${length() - pin.length === 1 ? "" : "s"}.` : "";
      else if (pinConfirm && pinConfirm === first) { text = "PINs match."; tone = "ok"; ready = true; }
      else text = "";
    }
    status.className = `lock-match ${tone}`;
    clear(status);
    if (text) append(status, tone === "ok" ? tickIcon() : null, text);
    lockButton.disabled = !ready;
  }

  const setMode = (next) => {
    mode = next;
    segmented.querySelectorAll(".lock-seg").forEach((button) => {
      const on = (next === "password") === (button.dataset.mode === "password");
      button.classList.toggle("active", on); button.setAttribute("aria-selected", String(on));
    });
    pinView.hidden = next === "password"; pwView.hidden = next !== "password";
    body.classList.toggle("is-password", next === "password");
    if (next !== "password") resetPin();
    refresh();
    setTimeout(() => (next === "password" ? pwMain.focus() : pinMain.focus()), 40);
  };
  segmented.addEventListener("click", (event) => {
    const button = event.target.closest(".lock-seg");
    if (button) setMode(button.dataset.mode === "password" ? "password" : length() === 8 ? "pin8" : "pin6");
  });
  lengthChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".lock-chip");
    if (!chip) return;
    mode = chip.dataset.len === "8" ? "pin8" : "pin6";
    lengthChips.querySelectorAll(".lock-chip").forEach((c) => { const on = c === chip; c.classList.toggle("active", on); c.setAttribute("aria-checked", String(on)); });
    pinMain.setLength(length());
    resetPin(); refresh(); pinMain.focus();
  });

  lockButton.addEventListener("click", async () => {
    if (lockButton.disabled) return;
    if (mode === "password" && pw !== pwConfirm) {
      /* Both entries are made again. */
      [pwMain, pwAgain].forEach((field) => { field.node.classList.remove("shake"); void field.node.offsetWidth; field.node.classList.add("shake"); field.input.classList.add("is-bad"); });
      status.className = "lock-match bad"; status.textContent = "Those passwords didn’t match. Enter both again.";
      setTimeout(() => { pwMain.clear(); pwAgain.clear(); pw = ""; pwConfirm = ""; meter.update(""); [pwMain, pwAgain].forEach((f) => f.input.classList.remove("is-bad")); lockButton.disabled = true; pwMain.focus(); }, 650);
      return;
    }
    lockButton.disabled = true; lockButton.textContent = "Locking…";
    const secret = mode === "password" ? pw : first;
    const result = await api.post(`/api/notes/pages/${id}/lock`, { password: secret, kind: mode }).catch((error) => ({ error: error?.message }));
    if (result?.error || !result?.locked) { lockButton.textContent = "Lock page"; refresh(); status.className = "lock-match bad"; status.textContent = result?.error || "Could not lock the page."; return; }
    try { sessionStorage.setItem(`clyra.notes.unlocked.${id}`, "1"); } catch { /* optional */ }
    entry.close("done");
    await onDone?.();
    toast("Page locked");
  });

  const body = el("div", { class: "lock-dialog" },
    el("div", { class: "lock-hero" }, el("span", { class: "lock-hero-badge" }, icon("shield", 26))),
    el("h3", { class: "lock-title", text: "Lock this page" }),
    el("p", { class: "lock-dialog-text", text: "Nothing on it is shown until you enter your passcode." }),
    segmented, pinView, pwView, status, note);
  entry = modal({
    title: "Lock page", width: 420, body,
    footer: [el("button", { class: "button", type: "button", onclick: () => entry.close("cancel") }, "Cancel"),
             el("button", { class: "button", type: "button", onclick: () => { api.post(`/api/notes/pages/${id}/lock`, { password: "" }).then(async () => { entry.close("done"); await onDone?.(); toast("Page locked"); }); } }, "Lock without a passcode"),
             lockButton],
  });
  refresh();
}
