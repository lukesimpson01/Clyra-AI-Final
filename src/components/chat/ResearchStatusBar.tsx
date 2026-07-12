"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe } from "lucide-react";
import { ShiningText } from "@/components/ui/shining-text";
import type { ResearchSite } from "@/lib/researchClient";
import type { YouTubeVideoProgress } from "@/lib/youtubeClient";

const YOUTUBE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      fill="currentColor"
      d="M23.5 6.2c-.2-1-1-1.7-2-1.8C19.3 4 12 4 12 4s-7.3 0-9.5.4c-1 .1-1.8.8-2 1.8C0 8.4 0 12 0 12s0 3.6.5 5.8c.2 1 1 1.7 2 1.8C4.7 20 12 20 12 20s7.3 0 9.5-.4c1-.1 1.8-.8 2-1.8.5-2.2.5-5.8.5-5.8s0-3.6-.5-5.8z"
    />
    <path fill="#fff" d="M9.75 15.02l6.5-3.52-6.5-3.52v7.04z" />
  </svg>
);

const pillSpring = {
  type: "spring" as const,
  stiffness: 340,
  damping: 34,
  mass: 0.88,
};

function siteLabel(site: ResearchSite): string {
  const fromTitle = site.title?.trim();
  if (fromTitle && fromTitle.length > 2 && !fromTitle.toLowerCase().startsWith("http")) {
    return fromTitle.length > 24 ? `${fromTitle.slice(0, 24)}…` : fromTitle;
  }
  const host = site.host.replace(/^www\./i, "");
  return host.length > 22 ? `${host.slice(0, 22)}…` : host;
}

function CommandStyleIcon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function FaviconOrGlobe({ host }: { host: string }) {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return <Globe className="h-4 w-4 text-slate-600" aria-hidden="true" />;
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 object-contain"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function SitePill({ site, index }: { site: ResearchSite; index: number }) {
  const label = siteLabel(site);
  const faviconHost = site.host || "example.com";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -14, scale: 0.96, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: -8, scale: 0.98, filter: "blur(2px)" }}
      transition={{
        ...pillSpring,
        delay: index * 0.055,
      }}
      className="inline-flex items-center gap-2 rounded-[14px] bg-slate-100/80 px-2 py-1"
    >
      <CommandStyleIcon className="overflow-hidden">
        <FaviconOrGlobe host={faviconHost} />
      </CommandStyleIcon>
      <span className="max-w-[148px] truncate text-[13.5px] font-medium leading-tight text-slate-700">
        {label}
      </span>
    </motion.div>
  );
}

function VideoPill({ video, index }: { video: YouTubeVideoProgress; index: number }) {
  const label =
    video.title.length > 24 ? `${video.title.slice(0, 24)}…` : video.title;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -14, scale: 0.96, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: -8, scale: 0.98, filter: "blur(2px)" }}
      transition={{
        ...pillSpring,
        delay: index * 0.055,
      }}
      className="inline-flex items-center gap-2 rounded-[14px] bg-slate-100/80 px-2 py-1"
    >
      <CommandStyleIcon className="bg-[#FF0000] text-white shadow-[0_1px_2px_rgba(255,0,0,0.18)]">
        {YOUTUBE_ICON}
      </CommandStyleIcon>
      <span className="max-w-[148px] truncate text-[13.5px] font-medium leading-tight text-slate-700">
        {label}
      </span>
    </motion.div>
  );
}

type ResearchStatusBarProps = {
  mode?: "web" | "youtube";
  sites?: ResearchSite[];
  videos?: YouTubeVideoProgress[];
  messageTextClass?: string;
};

export function ResearchStatusBar({
  mode = "web",
  sites = [],
  videos = [],
  messageTextClass = "text-[15px] sm:text-[16px]",
}: ResearchStatusBarProps) {
  const label =
    mode === "youtube" ? "Analysing youtube video" : "Searching…";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-center gap-2 py-1"
    >
      {mode === "youtube" ? (
        <CommandStyleIcon className="bg-[#FF0000] text-white shadow-[0_1px_2px_rgba(255,0,0,0.18)]">
          {YOUTUBE_ICON}
        </CommandStyleIcon>
      ) : (
        <CommandStyleIcon>
          <Globe className="h-4 w-4 text-slate-700" aria-hidden="true" />
        </CommandStyleIcon>
      )}
      <ShiningText text={label} className={messageTextClass} />
      <motion.div layout className="flex flex-wrap items-center gap-2">
        <AnimatePresence mode="popLayout">
          {mode === "youtube"
            ? videos.map((video, index) => (
                <VideoPill
                  key={`${video.video_id}-${video.url}`}
                  video={video}
                  index={index}
                />
              ))
            : sites.map((site, index) => (
                <SitePill
                  key={`${site.url}-${site.host}`}
                  site={site}
                  index={index}
                />
              ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
