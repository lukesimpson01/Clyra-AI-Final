import WebSocket from "ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eye = (await (await fetch("http://127.0.0.1:9223/json")).json()).find((t) => t.url.includes("5179"));
const ws = new WebSocket(eye.webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0; const pending = new Map();
ws.on("message", (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (d) => res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.value;
await send("Page.navigate", { url: "http://localhost:5179/" });
for (let t = 0; t < 9; t++) {
  await sleep(4000);
  console.log(`t=${(t + 1) * 4}s`, await ev(`JSON.stringify({ status: document.getElementById('loader-status')?.textContent || document.querySelector('.loader-status')?.textContent || '', intro: document.body.classList.contains('eye-intro'), layers: (location.hash.match(/&l=[^&]*/)||['none'])[0], alt: (location.hash.match(/alt=[0-9]+/)||[''])[0] })`));
}
ws.close();
