/**
 * Real-shell bridge shared by every terminal surface in the app (the Vibe
 * Coder's TerminalPanel and the chat's "Run" drawer). Talks to the Electron
 * PTY bridge when available, otherwise falls back to the /api/terminal
 * WebSocket served by lib/terminal-ws.ts.
 */
export type TerminalBridge = {
  open: (projectId: string, tabId: string) => Promise<void>;
  write: (tabId: string, data: string) => void;
  resize: (tabId: string, cols: number, rows: number) => void;
  kill: (tabId: string) => void;
  onData: (cb: (tabId: string, data: string) => void) => () => void;
  onExit: (cb: (tabId: string, code: number) => void) => () => void;
};

export function electronTerminalBridge(): TerminalBridge | null {
  const bridge = window.clyraDesktop?.terminal;
  if (!bridge) return null;
  return {
    open: async (projectId, tabId) => { await bridge.open({ projectId, tabId }); },
    write: (tabId, data) => void bridge.write({ tabId, data }),
    resize: (tabId, cols, rows) => void bridge.resize({ tabId, cols, rows }),
    kill: (tabId) => void bridge.kill({ tabId }),
    onData: (cb) => bridge.onData((payload) => {
      if (typeof payload === "string") cb("default", payload);
      else if (payload.data) cb(payload.tabId || "default", payload.data);
    }),
    onExit: (cb) => bridge.onExit((payload) => {
      if (typeof payload === "number") cb("default", payload);
      else cb(payload.tabId || "default", payload.code ?? 0);
    }),
  };
}

export function websocketTerminalBridge(): TerminalBridge {
  const sockets = new Map<string, WebSocket>();
  const dataCbs = new Set<(tabId: string, data: string) => void>();
  const exitCbs = new Set<(tabId: string, code: number) => void>();
  return {
    open: async (projectId, tabId) => {
      const existing = sockets.get(tabId);
      if (existing?.readyState === WebSocket.OPEN) return;
      if (existing?.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve, reject) => {
          existing.addEventListener("open", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("Terminal connection failed.")), { once: true });
        });
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/terminal?projectId=${encodeURIComponent(projectId)}&tabId=${encodeURIComponent(tabId)}`);
      sockets.set(tabId, socket);
      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as { type?: string; tabId?: string; data?: string; code?: number };
          if (payload.type === "data" && payload.data) for (const cb of dataCbs) cb(payload.tabId || tabId, payload.data);
          if (payload.type === "exit") for (const cb of exitCbs) cb(payload.tabId || tabId, payload.code ?? 0);
        } catch { /* ignore malformed frames */ }
      };
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("Terminal connection failed.")), { once: true });
      });
    },
    write: (tabId, data) => {
      const socket = sockets.get(tabId);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    },
    resize: (tabId, cols, rows) => {
      const socket = sockets.get(tabId);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
    },
    kill: (tabId) => { sockets.get(tabId)?.close(); sockets.delete(tabId); },
    onData: (cb) => { dataCbs.add(cb); return () => dataCbs.delete(cb); },
    onExit: (cb) => { exitCbs.add(cb); return () => exitCbs.delete(cb); },
  };
}

export function createTerminalBridge(): TerminalBridge {
  return electronTerminalBridge() ?? websocketTerminalBridge();
}
