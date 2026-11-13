import type { ReactNode } from "react";
import {
  Bell, Check, ChevronDown, CircleCheck, Code2, FileText, FolderOpen,
  Image as ImageIcon, Paperclip, Search, Send, Settings, Terminal, User,
} from "lucide-react";
import type { ComponentCatalogItem } from "./api";
import { cn } from "../../lib/utils";

/**
 * Purpose-built, type-specific illustrative component previews.
 * These never execute third-party source code. Open the item's details for
 * the actual locally checked-out source, dependencies and installation.
 */
export function ComponentPreview({ item, compact = false }: { item: ComponentCatalogItem; compact?: boolean }) {
  const name = item.name.toLowerCase();
  const base = "text-[10px] text-[#525761]";
  let content: ReactNode;

  if (/^(button|button-group|send-button|attachment-button)$/.test(name)) {
    content = <div className="flex items-center gap-2"><span className="rounded-[8px] bg-[#27292e] px-3.5 py-2 text-[11px] font-medium text-white">{name === "send-button" ? "Send" : name === "attachment-button" ? "Attach" : "Continue"}</span><span className="rounded-[8px] bg-black/[0.055] px-3 py-2 text-[11px] text-[#545760]">Cancel</span></div>;
  } else if (/^(input|input-group|textarea|field|input-typing|model-picker|mode-selector|native-select|input-otp)$/.test(name)) {
    content = <div className="w-[80%] max-w-[240px] space-y-2"><span className={base}>{name === "input-otp" ? "Verification code" : name === "model-picker" ? "Choose model" : "Email address"}</span><div className="flex items-center justify-between rounded-[8px] bg-white px-3 py-2 text-[11px] text-[#9699a2] shadow-[inset_0_0_0_1px_#e3e4e8]"><span>{name === "input-otp" ? "2  8  4  6" : name === "model-picker" ? "Choose a model" : "name@example.com"}</span>{name.includes("select") || name.includes("picker") ? <ChevronDown className="h-3 w-3"/> : null}</div></div>;
  } else if (/^(checkbox|switch|toggle|toggle-group|radio-group)$/.test(name)) {
    content = <div className="flex items-center gap-3"><div className="relative h-[22px] w-10 rounded-full bg-[#3977f6]"><span className="absolute right-[3px] top-[3px] h-4 w-4 rounded-full bg-white"/></div><span className="text-[12px] text-[#464850]">Enabled</span><Check className="h-3.5 w-3.5 text-[#3977f6]"/></div>;
  } else if (/^(tabs|navigation-menu|menubar|breadcrumb|pagination)$/.test(name)) {
    content = <div className="flex items-center gap-3 text-[11px]"><span className="border-b-2 border-[#3977f6] pb-2 text-[#27292d]">Overview</span><span className="pb-2 text-[#92949c]">Activity</span><span className="pb-2 text-[#92949c]">Settings</span></div>;
  } else if (/^(avatar|user-message)$/.test(name)) {
    content = <div className="flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#cfe1ff] text-[#527ab1]"><User className="h-5 w-5"/></span><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f1d4ca] text-[#996f62]"><User className="h-5 w-5"/></span><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e5e6eb] text-[11px] text-[#62656f]">+3</span></div>;
  } else if (/^(card|hover-card|item|empty)$/.test(name)) {
    content = <div className="w-[77%] max-w-[225px] rounded-xl bg-white p-3 shadow-[0_2px_18px_#0000000b,0_0_0_1px_#e8e9ee]"><div className="text-[11px] font-medium text-[#363941]">Project overview</div><div className="mt-1 text-[9px] text-[#9ca0a7]">Everything in one place</div><div className="mt-3 h-2 w-[78%] rounded-full bg-[#eaecf1]"/><div className="mt-1.5 h-2 w-[54%] rounded-full bg-[#f0f1f5]"/></div>;
  } else if (/^(badge|kbd|alert)$/.test(name)) {
    content = <div className="flex items-center gap-2"><span className="rounded-full bg-[#eaf1ff] px-3 py-1.5 text-[10px] text-[#3977f6]">Active</span><span className="rounded-full bg-[#eaf5ef] px-3 py-1.5 text-[10px] text-[#3b8866]">Ready</span></div>;
  } else if (/^(accordion|collapsible)$/.test(name)) {
    content = <div className="w-[80%] max-w-[220px] space-y-2 text-[10px] text-[#51545b]"><div className="flex justify-between"><span>Getting started</span><ChevronDown className="h-3 w-3"/></div><div className="h-px bg-[#dadce3]"/><div className="flex justify-between"><span>More details</span><ChevronDown className="h-3 w-3"/></div></div>;
  } else if (/^(dialog|alert-dialog|drawer|sheet|popover|context-menu|dropdown-menu|tooltip)$/.test(name)) {
    content = <div className="w-[78%] max-w-[230px] rounded-xl bg-white p-3 shadow-[0_7px_25px_#00000016]"><div className="text-[11px] font-medium text-[#30333a]">Confirm changes</div><div className="mt-2 h-2 w-4/5 rounded-full bg-[#e9ebef]"/><div className="mt-3 flex justify-end gap-2"><span className="rounded-md bg-[#f2f2f4] px-2 py-1 text-[9px]">Back</span><span className="rounded-md bg-[#3977f6] px-2 py-1 text-[9px] text-white">Done</span></div></div>;
  } else if (/^(calendar|date-picker)$/.test(name)) {
    content = <div className="rounded-lg bg-white px-3 py-2.5 shadow-[0_0_0_1px_#e8e9ee]"><div className="mb-1 text-center text-[10px] font-medium">November</div><div className="grid grid-cols-7 gap-1 text-center text-[8px] text-[#858995]">{["M","T","W","T","F","S","S","9","10","11","12","13","14","15"].map((day,i)=><span className={cn("flex h-4 w-4 items-center justify-center rounded-full",i===11&&"bg-[#3977f6] text-white")} key={i}>{day}</span>)}</div></div>;
  } else if (/^(table|data-table)$/.test(name)) {
    content = <div className="w-[84%] max-w-[250px] space-y-2 text-[9px] text-[#6b6f78]"><div className="flex justify-between border-b border-[#dce0e8] pb-1.5 font-medium"><span>Name</span><span>Status</span></div><div className="flex justify-between"><span>Dashboard</span><span className="text-[#3c8a70]">Ready</span></div><div className="flex justify-between border-t border-[#e5e7ec] pt-1.5"><span>Settings</span><span>Draft</span></div></div>;
  } else if (/^(chart)$/.test(name)) {
    content = <div className="flex h-20 items-end gap-2 border-b border-[#d4d7de] px-2"><span className="w-5 rounded-t bg-[#bdd4ff]" style={{height:"46%"}}/><span className="w-5 rounded-t bg-[#8eb4ff]" style={{height:"72%"}}/><span className="w-5 rounded-t bg-[#3977f6]" style={{height:"96%"}}/><span className="w-5 rounded-t bg-[#84affc]" style={{height:"62%"}}/><span className="w-5 rounded-t bg-[#bdd4ff]" style={{height:"85%"}}/></div>;
  } else if (/^(progress|slider|skeleton|spinner|spiral-loader|text-shimmer)$/.test(name)) {
    content = <div className="w-[78%] max-w-[220px] space-y-3"><div className="h-2 w-full overflow-hidden rounded-full bg-[#e6e8ee]"><div className="h-full w-[63%] rounded-full bg-[#3977f6]"/></div><div className="h-2 w-[76%] rounded-full bg-[#e7e9ef]"/><div className="h-2 w-[48%] rounded-full bg-[#eceef2]"/></div>;
  } else if (/^(search-tool|search-modal|search-context|command|search-trigger)$/.test(name)) {
    content = <div className="w-[83%] max-w-[245px] rounded-xl bg-white p-2.5 shadow-[0_0_0_1px_#e7e9ee]"><div className="flex items-center gap-2"><Search className="h-3.5 w-3.5 text-[#9699a1]"/><span className="text-[11px] text-[#979aa2]">Search files…</span></div><div className="mt-2 border-t border-[#eff0f3] pt-2 text-[10px] text-[#555a64]">Found 4 results</div></div>;
  } else if (/^(bash-tool|tool-row-base)$/.test(name)) {
    content = <div className="w-[83%] max-w-[245px] rounded-lg bg-[#252a34] px-3 py-2.5 font-mono text-[10px] text-[#e4e7ee]"><div className="flex items-center gap-2 text-[#abb4c6]"><Terminal className="h-3 w-3"/><span>Terminal</span></div><div className="mt-2 text-[#93d9b7]">$ npm run build</div><div className="mt-1 text-[#a5acb8]">✓ Complete</div></div>;
  } else if (/^(edit-tool)$/.test(name)) {
    content = <div className="w-[83%] max-w-[245px] rounded-lg bg-white p-3 shadow-[0_0_0_1px_#e4e7ed]"><div className="flex items-center gap-1.5 text-[10px] text-[#60636b]"><Code2 className="h-3 w-3"/><span>Updated index.tsx</span></div><div className="mt-2 rounded bg-[#eff9f2] px-2 py-1 font-mono text-[9px] text-[#3b8660]">+ const ready = true;</div><div className="mt-1 text-[9px] text-[#8b8f99]">1 addition</div></div>;
  } else if (/^(todo-tool|plan-tool)$/.test(name)) {
    content = <div className="w-[80%] max-w-[240px] space-y-2 rounded-lg bg-white p-3 shadow-[0_0_0_1px_#e4e7ed]"><div className="text-[10px] font-medium text-[#4b4e56]">{name === "plan-tool" ? "Implementation plan" : "Tasks"}</div>{["Inspect source","Build component","Run checks"].map((line,i)=><div key={line} className="flex items-center gap-2 text-[10px] text-[#737782]"><CircleCheck className={cn("h-3 w-3",i===0?"text-[#48a17c]":"text-[#c9ccd3]")}/><span>{line}</span></div>)}</div>;
  } else if (/^(agent-chat|message-list|markdown|question-tool|question-prompt|thinking-tool|subagent-tool|mcp-tool|generic-tool|tool-group|tool-renderer)$/.test(name)) {
    content = <div className="w-[83%] max-w-[240px] space-y-2"><div className="mr-6 rounded-xl bg-white p-2.5 text-[10px] text-[#5d626c] shadow-[0_0_0_1px_#e9eaf0]">How can I help with your project?</div><div className="ml-8 rounded-xl bg-[#e9f1ff] p-2.5 text-[10px] text-[#3c638f]">Build a clean dashboard</div><div className="flex items-center gap-1.5 px-1 text-[9px] text-[#9297a0]"><CircleCheck className="h-3 w-3 text-[#3977f6]"/>Analyzing source</div></div>;
  } else if (/^(input-bar|suggestions)$/.test(name)) {
    content = <div className="flex w-[86%] max-w-[245px] items-center justify-between rounded-xl bg-white p-2.5 text-[10px] text-[#9da1aa] shadow-[0_0_0_1px_#e5e7ec]"><Paperclip className="h-3.5 w-3.5"/><span>Message Clyra…</span><span className="rounded-lg bg-[#3977f6] p-1 text-white"><Send className="h-3 w-3"/></span></div>;
  } else if (/^(file-attachment|image-lightbox|attachment)$/.test(name)) {
    content = <div className="flex w-[78%] max-w-[220px] items-center gap-3 rounded-lg bg-white p-3 shadow-[0_0_0_1px_#e5e7ec]"><ImageIcon className="h-5 w-5 text-[#3977f6]"/><div className="text-[10px] text-[#4c5059]"><div>preview.png</div><div className="text-[#a2a6ae]">340 KB</div></div></div>;
  } else if (/^(sidebar|resizable|scroll-area|aspect-ratio|carousel|separator)$/.test(name)) {
    content = <div className="flex h-[76%] max-h-[105px] w-[79%] max-w-[225px] gap-2 rounded-lg bg-white p-2 shadow-[0_0_0_1px_#e5e7ec]"><div className="w-1/3 space-y-2 rounded bg-[#e9ecf3] p-1.5"><div className="h-1.5 rounded bg-[#c5d4f4]"/><div className="h-1.5 w-2/3 rounded bg-[#d4d9e3]"/></div><div className="min-w-0 flex-1 space-y-2 px-1 pt-1"><div className="h-2 w-5/6 rounded bg-[#e9ebf0]"/><div className="h-2 w-3/5 rounded bg-[#eff0f3]"/><div className="mt-3 h-5 rounded bg-[#eaf0ff]"/></div></div>;
  } else if (/^(sonner|toast|alert-dialog|error-message)$/.test(name)) {
    content = <div className="flex w-[83%] max-w-[245px] items-center gap-2 rounded-xl bg-white p-3 text-[10px] text-[#545962] shadow-[0_4px_18px_#00000012]"><CircleCheck className="h-5 w-5 text-[#3c9a72]"/>Changes saved successfully</div>;
  } else if (/^(form|label|combobox|select|hover-card|radio|direction)$/.test(name)) {
    content = <div className="w-[77%] max-w-[220px] space-y-1.5"><div className={base}>{item.title}</div><div className="flex justify-between rounded-lg bg-white px-3 py-2 text-[11px] text-[#5b6069] shadow-[0_0_0_1px_#e4e6eb]">Select an option<ChevronDown className="h-3 w-3"/></div></div>;
  } else {
    // Never display an empty or broken preview; tailor the visible item identity.
    content = <div className="w-[80%] max-w-[230px] rounded-xl bg-white p-3 shadow-[0_0_0_1px_#e8eaf0]"><div className="flex items-center gap-2">{item.source === "21st" ? <Code2 className="h-4 w-4 text-[#3977f6]"/> : <Settings className="h-4 w-4 text-[#3977f6]"/>}<span className="truncate text-[11px] font-medium text-[#444954]">{item.title}</span></div><div className="mt-3 flex items-center justify-between gap-2 text-[9px] text-[#8d929d]"><span>Ready to customize</span>{name.includes("notification") ? <Bell className="h-3 w-3"/> : name.includes("file") ? <FolderOpen className="h-3 w-3"/> : <FileText className="h-3 w-3"/>}</div><div className="mt-2 h-1.5 w-3/4 rounded-full bg-[#edf0f4]"/></div>;
  }

  return <div className={cn("relative isolate flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-[12px]",item.source === "21st" ? "bg-[#f0f5fc]" : "bg-[#f6f6f8]", compact ? "p-3" : "p-5")}>
    {content}
    <span className="absolute bottom-1.5 right-2 text-[9px] text-[#a4a6ad]">Illustrative preview</span>
  </div>;
}
