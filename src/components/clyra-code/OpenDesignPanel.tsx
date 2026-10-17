import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { api } from "./api";

/**
 * The embedded OpenDesign product UI (nexu-io/open-design) that the Design
 * tab shows. The UI is served by the local OpenDesign daemon; Clyra only
 * checks its health through a same-origin endpoint and hosts it in an
 * iframe. When the daemon is not running the panel explains how to bring
 * it up instead of showing a blank frame.
 *
 * The iframe is warmed in the background shortly after the workspace mounts
 * (so app startup stays light) and never reloads afterwards — tab switches
 * are instant. The embedded UI talks back over postMessage when the user
 * asks to continue a project in Clyra Code.
 */

type OpenDesignStatus = { running: boolean; url: string };

export function OpenDesignPanel({
  onSendToCode,
  onDeploy,
}: {
  onSendToCode?: (projectId: string, projectName?: string) => void;
  onDeploy?: (projectId: string) => void;
}) {
  const [status, setStatus] = useState<OpenDesignStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [warmed, setWarmed] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onSendToCodeRef = useRef(onSendToCode);
  onSendToCodeRef.current = onSendToCode;
  const onDeployRef = useRef(onDeploy);
  onDeployRef.current = onDeploy;

  const check = () => {
    setChecking(true);
    fetch("/api/open-design/status")
      .then((response) => (response.ok ? response.json() : { running: false, url: "" }))
      .then((body: OpenDesignStatus) => {
        setStatus(body);
        if (body.running) setFrameKey((key) => key + 1);
      })
      .catch(() => setStatus({ running: false, url: "" }))
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    check();
    timerRef.current = window.setInterval(() => {
      void fetch("/api/open-design/status")
        .then((response) => (response.ok ? response.json() : { running: false, url: "" }))
        .then((body: OpenDesignStatus) => setStatus(body))
        .catch(() => setStatus({ running: false, url: "" }));
    }, 8000);
    // Defer the embed warm-up until the host app is idle: the workspace
    // loads instantly and the Design tab is still instant afterwards.
    const warmTimer = window.setTimeout(() => setWarmed(true), 1500);
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; projectId?: string; projectName?: string } | null;
      if (!payload || !payload.projectId) return;
      if (payload.type === "clyra:send-to-code") {
        onSendToCodeRef.current?.(payload.projectId, payload.projectName);
      } else if (payload.type === "clyra:deploy") {
        void (async () => {
          try {
            const result = await api.deployOpenDesignProject(payload.projectId!);
            frameRef.current?.contentWindow?.postMessage(
              { type: "clyra:deploy-result", projectId: payload.projectId, ok: true, url: result.url },
              "*",
            );
          } catch (error) {
            frameRef.current?.contentWindow?.postMessage(
              { type: "clyra:deploy-result", projectId: payload.projectId, ok: false, error: error instanceof Error ? error.message : "Deploy failed." },
              "*",
            );
          }
        })();
        onDeployRef.current?.(payload.projectId);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      window.clearTimeout(warmTimer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  if (!status?.running) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        {checking ? <LoaderCircle className="h-4 w-4 animate-spin text-[#9A9CA0]" /> : null}
        <p className="text-[13px] font-medium text-[#45474C]">
          {checking ? "Starting Clyra Design…" : "Clyra Design is not running"}
        </p>
        <p className="max-w-[380px] text-[11.5px] leading-[1.55] text-[#96989D]">
          The Design tab embeds the Clyra Design workspace. Start its local daemon with{" "}
          <span className="cc-mono rounded bg-black/[0.045] px-1 py-0.5 text-[10.5px] text-[#55575C]">npm run dev</span>{" "}
          (or <span className="cc-mono rounded bg-black/[0.045] px-1 py-0.5 text-[10.5px] text-[#55575C]">npm run dev:open-design</span>),
          and build it once with <span className="cc-mono rounded bg-black/[0.045] px-1 py-0.5 text-[10.5px] text-[#55575C]">npm run setup:open-design</span>.
        </p>
        <button
          type="button"
          onClick={check}
          className="mt-2 inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-[#3977F6] px-3.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2} />
          Retry
        </button>
      </div>
    );
  }

  if (!warmed) {
    // The panel is mounted (its status check runs) but the heavy embed is
    // not created until the host has settled. Keeps the first paint light.
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoaderCircle className="h-4 w-4 animate-spin text-[#C1C3C7]" />
      </div>
    );
  }

  return (
    <iframe
      key={frameKey}
      ref={frameRef}
      title="OpenDesign"
      src={status.url}
      className="h-full w-full border-0 bg-white"
      allow="clipboard-read; clipboard-write"
    />
  );
}
