import { useEffect, useRef, useState } from "react";
import { getElectronDesktop } from "../../lib/electron-runtime";
import { resolveDeviceLocation } from "../../hooks/useDeviceLocation";

/**
 * Clyra Eye is the original God's Eye View app, run from apps/clyra-eye.
 * In the desktop app it is shown in a native web view placed over this area
 * (electron/eye-view.mjs), so the app's own UI and layout are unchanged. Clyra
 * adds nothing on top of it.
 */
type EyeState = "checking" | "ready" | "offline" | "web";

export function ClyraEyeWorkspace({ suspended = false }: { suspended?: boolean }) {
  const desktop = getElectronDesktop();
  const eye = desktop?.eye;
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<EyeState>(eye ? "checking" : "web");

  useEffect(() => {
    if (!eye) return;
    let cancelled = false;
    eye
      .status()
      .then((result) => {
        if (cancelled) return;
        setState(result.reachable ? "ready" : "offline");
        // Same location lookup Clyra Maps uses, handed to the Eye intro.
        if (result.reachable) {
          void resolveDeviceLocation().then((location) => {
            if (location) void eye.setLocation(location);
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState("offline");
      });
    return () => {
      cancelled = true;
    };
    // The desktop bridge is fixed for the life of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Eye server can start after the desktop app, so an offline result is not
  // final: keep checking until it answers, then hand the rectangle to the native view.
  useEffect(() => {
    if (!eye || state !== "offline") return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      eye
        .status()
        .then((result) => {
          if (!cancelled && result.reachable) setState("ready");
        })
        .catch(() => {});
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // The desktop bridge is fixed for the life of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const host = hostRef.current;
    if (state !== "ready" || !eye || !host || suspended) return;
    const place = () => {
      const rect = host.getBoundingClientRect();
      void eye.setSurface({
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        visible: true,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      void eye.setSurface({ visible: false });
    };
    // Only the readiness state and Task View suspension should re-run this; the bridge is fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, suspended]);

  if (state === "web") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[15px] font-semibold text-[#303136]">Clyra Eye runs in the Clyra desktop app</p>
        <p className="max-w-sm text-[13px] text-[#77787d]">
          Open the app in your browser at <code>http://localhost:5179</code> after running{" "}
          <code>npm run eye:dev</code>.
        </p>
      </div>
    );
  }

  if (state === "offline") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[15px] font-semibold text-[#303136]">Clyra Eye isn’t running</p>
        <p className="max-w-sm text-[13px] text-[#77787d]">
          Start it with <code>npm run eye:dev</code> from the project root, then reopen this app.
        </p>
      </div>
    );
  }

  // A native view can't be transformed or clipped by the Task View deck, so
  // while the deck is open the Eye yields its rectangle to a plain card face.
  if (suspended) {
    return <div className="flex h-full w-full items-center justify-center bg-[#fbfbfa] text-[13px] font-medium text-[#8a8d94]" aria-label="Clyra Eye">Clyra Eye</div>;
  }

  // The native view is drawn over this element's rectangle.
  return <div ref={hostRef} className="h-full w-full bg-black" aria-label="Clyra Eye" />;
}
