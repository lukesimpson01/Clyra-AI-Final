import dgram from "node:dgram";
import { execFile } from "node:child_process";

/**
 * Carries Clyra Flow to the Notch app (apps/notch) over local UDP when the Flow indicator is set to "Notch":
 * state and microphone level go out on 31416, stop/cancel come back on 31417. Datagrams keep the 60 Hz level
 * stream light and never block the dictation pipeline; if the Notch is not running nothing is lost.
 */
export class NotchBridge {
  constructor({ onAction, onMessage } = {}) {
    this.onMessage = onMessage;
    this.tx = dgram.createSocket("udp4");
    this.tx.on("error", () => {});
    this.alive = false;
    this.rx = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.rx.on("error", () => {});
    this.rx.on("message", (buffer) => {
      try {
        const message = JSON.parse(buffer.toString("utf8"));
        if (message?.op) this.onMessage?.(message);
        else if (message?.action === "stop" || message?.action === "cancel") onAction?.(message.action);
      } catch { /* ignore a damaged datagram */ }
    });
    try { this.rx.bind(31417, "127.0.0.1"); } catch { /* port busy: the pill window still works */ }
    this.poll = setInterval(() => this.check(), 4_000);
    this.poll.unref?.();
    this.check();
  }

  check() {
    if (process.platform !== "darwin") return;
    execFile("pgrep", ["-x", "Clyra’s Notch"], (error, stdout) => { this.alive = !error && Boolean(String(stdout).trim()); });
  }

  send(message) {
    try { this.tx.send(Buffer.from(JSON.stringify(message)), 31416, "127.0.0.1"); } catch { /* best effort */ }
  }

  destroy() {
    clearInterval(this.poll);
    try { this.tx.close(); } catch { /* closed */ }
    try { this.rx.close(); } catch { /* closed */ }
  }
}
