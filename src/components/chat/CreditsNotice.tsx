import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";

/**
 * Shown in place of a reply when the model provider has no credits left. It is the whole answer for that turn:
 * what happened, what to do, and a live "Waiting for credits" check against the real provider. The moment a probe
 * succeeds it calls `onRecovered`, and the host hides it and puts the person back at their last message to re-send.
 */
export function CreditsNotice({
  surface,
  onRecovered,
  topUpUrl = "https://platform.deepseek.com/top_up",
}: {
  surface: "chat" | "vibe";
  onRecovered: () => void;
  topUpUrl?: string;
}) {
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const recovered = useRef(false);
  const inFlight = useRef(false);
  const nextAllowed = useRef(0);
  // the latest callback without making the polling effect depend on it
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  const check = useCallback(async (manual = false) => {
    if (recovered.current || inFlight.current) return;
    if (!manual && Date.now() < nextAllowed.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const response = await fetch("/api/chat/credit-status", { method: "POST" });
      if (response.status === 429) {
        // the server asked for quiet: honour it before asking again
        nextAllowed.current = Date.now() + (Number(response.headers.get("retry-after")) || 60) * 1000;
        return;
      }
      const data = (await response.json()) as { ok?: boolean };
      nextAllowed.current = Date.now() + 15_000;
      if (data.ok && !recovered.current) {
        recovered.current = true;
        onRecoveredRef.current();
      }
    } catch {
      /* offline or the server is restarting: the next check will tell */
      nextAllowed.current = Date.now() + 15_000;
    } finally {
      inFlight.current = false;
      setChecking(false);
      setLastChecked(Date.now());
    }
  }, []);

  // poll quietly while this is on screen and the tab is visible
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void check(); };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [check]);

  return (
    <section className="clyra-credits" role="alert" aria-live="polite" data-surface={surface}>
      <div className="clyra-credits__icon" aria-hidden><Sparkles /></div>
      <div className="clyra-credits__body">
        <h3 className="clyra-credits__title">Clyra is out of AI credits</h3>
        <p className="clyra-credits__text">
          {surface === "vibe"
            ? "Your build is paused, and nothing has been lost. Add credits to the model account and it picks up right where you left off."
            : "Your message is safe. Add credits to the model account and you can send it again straight away."}
        </p>
        <div className="clyra-credits__actions">
          <a className="clyra-credits__primary" href={topUpUrl} target="_blank" rel="noopener noreferrer">
            Add credits <ArrowUpRight />
          </a>
          <button type="button" className="clyra-credits__secondary" onClick={() => void check(true)} disabled={checking}>
            <RefreshCw className={checking ? "is-spinning" : undefined} /> {checking ? "Checking…" : "Check again"}
          </button>
        </div>
        <p className="clyra-credits__status">
          <span className="clyra-credits__pulse" aria-hidden />
          {lastChecked ? "Still waiting for credits — checking automatically." : "Waiting for credits — checking automatically."}
        </p>
      </div>
    </section>
  );
}
