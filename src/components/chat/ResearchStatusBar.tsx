"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
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

function siteLabel(site: ResearchSite): string {
  const fromTitle = site.title?.trim();
  if (fromTitle && fromTitle.length > 2 && !fromTitle.toLowerCase().startsWith("http")) {
    return fromTitle.length > 28 ? `${fromTitle.slice(0, 28)}…` : fromTitle;
  }
  const host = site.host.replace(/^www\./i, "");
  return host.length > 24 ? `${host.slice(0, 24)}…` : host;
}

function SitePill({ site, index }: { site: ResearchSite; index: number }) {
  const label = siteLabel(site);
  const faviconHost = site.host || "example.com";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.42,
        delay: index * 0.12,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-[#EBEBEB] px-3 py-1.5"
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-slate-900">
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(faviconHost)}&sz=32`}
          alt=""
          width={16}
          height={16}
          className="h-3.5 w-3.5 object-cover"
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className="max-w-[180px] truncate text-[15px] sm:text-[16px] font-medium text-slate-700">
        {label}
      </span>
    </motion.div>
  );
}

function VideoPill({ video, index }: { video: YouTubeVideoProgress; index: number }) {
  const label =
    video.title.length > 30 ? `${video.title.slice(0, 30)}…` : video.title;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.42,
        delay: index * 0.12,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-[#EBEBEB] px-3 py-1.5"
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-[#FF0000] text-white">
        {YOUTUBE_ICON}
      </span>
      <span className="max-w-[200px] truncate text-[15px] sm:text-[16px] font-medium text-slate-700">
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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-center gap-2.5 py-1"
    >
      {mode === "youtube" ? (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#FF0000] text-white">
          {YOUTUBE_ICON}
        </span>
      ) : null}
      <ShiningText text={label} className={messageTextClass} />
      <AnimatePresence mode="popLayout">
        {mode === "youtube"
          ? videos.map((video, index) => (
              <VideoPill key={`${video.video_id}-${video.url}`} video={video} index={index} />
            ))
          : sites.map((site, index) => (
              <SitePill key={`${site.url}-${site.host}`} site={site} index={index} />
            ))}
      </AnimatePresence>
    </motion.div>
  );
}
