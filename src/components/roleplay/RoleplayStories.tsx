import { useMemo, useState } from "react";
import { MessageSquare, Search, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { relativeTime } from "../../lib/roleplay/helpers";
import type { RoleplayChat, RoleplayCharacter } from "../../lib/roleplay/types";
import { RoleplayPortrait } from "./RoleplayCharacterCard";

type Entry = { chat: RoleplayChat; character: RoleplayCharacter };

/** Groups stories the way someone actually looks for them: by when they last
 *  played, not by an absolute date they would have to remember. */
function bucketFor(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Earlier";
  const days = (Date.now() - then) / 86_400_000;
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return "Earlier";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This week", "This month", "Earlier"];

/**
 * Every story across every character, in one place, resumable.
 *
 * The home rail only carries the handful of most recent stories, which means
 * anything older than about a week becomes unreachable without remembering
 * which character it belonged to. This is the page that makes a long history
 * navigable.
 */
export function RoleplayStories({
  entries,
  onOpen,
  onDelete,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matched = needle
      ? entries.filter(({ chat, character }) =>
          character.name.toLocaleLowerCase().includes(needle) ||
          (chat.title || "").toLocaleLowerCase().includes(needle) ||
          chat.messages.some((message) => message.content.toLocaleLowerCase().includes(needle)))
      : entries;
    const byBucket = new Map<string, Entry[]>();
    for (const entry of matched) {
      const bucket = bucketFor(entry.chat.updatedAt);
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), entry]);
    }
    return BUCKET_ORDER.flatMap((bucket) => {
      const items = byBucket.get(bucket);
      return items?.length ? [{ bucket, items }] : [];
    });
  }, [entries, query]);

  const total = entries.length;

  return (
    <div className="rp-page-frame pb-24 pt-10">
      <div className="rp-section-heading">
        <h2>Your stories</h2>
      </div>
      <p className="mt-1 text-[13px] text-[var(--clyra-color-label-secondary)]">
        {total ? `${total} ${total === 1 ? "story" : "stories"} — pick up any of them where you left off.` : "Stories you start will collect here."}
      </p>

      {total ? (
        <label className="mt-5 flex h-10 w-full max-w-[420px] items-center gap-2.5 rounded-[var(--clyra-radius-md)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] px-3 transition-colors focus-within:border-[color:var(--clyra-color-accent)]">
          <Search className="h-4 w-4 shrink-0 text-[var(--clyra-color-label-tertiary)]" strokeWidth={1.8} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search characters and what was said…"
            aria-label="Search your stories"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--clyra-color-label)] outline-none placeholder:text-[var(--clyra-color-label-tertiary)]"
          />
        </label>
      ) : null}

      {!total ? (
        <div className="mt-10 flex flex-col items-start gap-3">
          <p className="text-[13px] text-[var(--clyra-color-label-tertiary)]">Open a character and send a message to start your first story.</p>
        </div>
      ) : !groups.length ? (
        <p className="mt-10 text-[13px] text-[var(--clyra-color-label-tertiary)]">No story matches “{query.trim()}”.</p>
      ) : (
        groups.map(({ bucket, items }) => (
          <section key={bucket} className="mt-8">
            <p className="rp-sidebar-eyebrow">{bucket}</p>
            <div className="mt-2 grid min-w-0 gap-0.5">
              {items.map((entry) => {
                const { chat, character } = entry;
                const last = [...chat.messages].reverse().find((message) => message.content.trim());
                return (
                  <div
                    key={chat.id}
                    className="group flex min-w-0 items-center gap-3 rounded-[var(--clyra-radius-md)] px-2.5 py-2 transition-colors hover:bg-[var(--clyra-color-surface)]"
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <RoleplayPortrait character={character} className="h-11 w-11 shrink-0 rounded-[13px]" initialsClassName="text-[13px]" />
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <strong className="truncate text-[13.5px] font-semibold text-[var(--clyra-color-label)]">{character.name}</strong>
                          <span className="shrink-0 text-[11px] text-[var(--clyra-color-label-tertiary)]">{relativeTime(chat.updatedAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--clyra-color-label-secondary)]">
                          {last ? last.content : chat.title || "New story"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 pr-1 text-[11px] text-[var(--clyra-color-label-tertiary)]">
                        <MessageSquare className="h-3 w-3" strokeWidth={1.9} />
                        {chat.messages.length}
                      </span>
                    </button>
                    {/* Secondary and destructive, so it stays out of the way
                        until the row is actually being considered. */}
                    <button
                      type="button"
                      onClick={() => onDelete(entry)}
                      aria-label={`Delete story with ${character.name}`}
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-[var(--clyra-radius-sm)] text-[var(--clyra-color-label-tertiary)] opacity-0 transition-[opacity,color,background-color]",
                        "hover:bg-[var(--clyra-color-danger-soft)] hover:text-[var(--clyra-color-danger)] focus-visible:opacity-100 group-hover:opacity-100",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
