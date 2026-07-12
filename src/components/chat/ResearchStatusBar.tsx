"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { ShiningText } from "@/components/ui/shining-text";
import type { ResearchSite } from "@/lib/researchClient";

function siteLabel(site: ResearchSite): string {
  const fromTitle = site.title?.trim();
  if (fromTitle && fromTitle.length > 2 && !fromTitle.toLowerCase().startsWith("http")) {
    return fromTitle.length > 28 ? `${fromTitle.slice(0, 28)}…` : fromTitle;
  }
  const host = site.host.replace(/^www\./i, "");
  return host.length > 24 ? `${host.slice(0, 24)}…` : host;
}

function SitePill({ site }: { site: ResearchSite }) {
  const label = siteLabel(site);
  const faviconHost = site.host || new URL(site.url).host;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
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
      <span className="max-w-[180px] truncate text-[13px] font-medium text-slate-700">
        {label}
      </span>
    </motion.div>
  );
}

export function ResearchStatusBar({ sites }: { sites: ResearchSite[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-center gap-2.5 py-1"
    >
      <ShiningText text="Searching…" className="text-[14px] font-medium" />
      <AnimatePresence mode="popLayout">
        {sites.map((site) => (
          <SitePill key={`${site.url}-${site.host}`} site={site} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
