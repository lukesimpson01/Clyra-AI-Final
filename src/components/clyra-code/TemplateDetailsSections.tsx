import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, ExternalLink, Image as ImageIcon, KeyRound, Monitor, Server, Star, X } from "lucide-react";
import type { TemplateManifest } from "./api";
import { sampleTemplateRating, sampleTemplateReviews } from "./templateReviewSamples";
import { discoverOfficialScreenshots } from "./templateSourceScreenshots";

/**
 * Detail-page additions shared by every entry in the Clyra Code source catalogue.
 * IMPORTANT: source screenshots and verified capabilities must come from the manifest.
 * Do not fabricate an app preview, rating, verified feature or API requirement.
 */

type LocalReview = {
  rating: number;
  title: string;
  body: string;
  updatedAt: string;
};
const REVIEW_PREFIX = "clyra-code-local-review-v1:";
const REVIEW_EVENT = "clyra-code-local-review-updated";

function readReview(id: string): LocalReview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REVIEW_PREFIX + id);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<LocalReview>;
    if (typeof item.rating !== "number" || !Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5 ||
        typeof item.title !== "string" || typeof item.body !== "string" ||
        typeof item.updatedAt !== "string") return null;
    return { rating: Number(item.rating), title: item.title.slice(0, 80), body: item.body.slice(0, 1000), updatedAt: item.updatedAt };
  } catch {
    return null;
  }
}

function useLocalReview(id: string) {
  const [review, setReview] = useState<LocalReview | null>(() => readReview(id));
  useEffect(() => {
    const sync = () => setReview(readReview(id));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(REVIEW_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(REVIEW_EVENT, sync);
    };
  }, [id]);
  const save = (value: LocalReview | null): boolean => {
    try {
      if (value) window.localStorage.setItem(REVIEW_PREFIX + id, JSON.stringify(value));
      else window.localStorage.removeItem(REVIEW_PREFIX + id);
      setReview(value);
      window.dispatchEvent(new Event(REVIEW_EVENT));
      return true;
    } catch {
      return false;
    }
  };
  return { review, save };
}

function Stars({ rating, size = 15 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={rating.toFixed(1) + " out of 5 stars"}>
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} className="relative block shrink-0" style={{ height: size, width: size }} aria-hidden="true">
          <Star size={size} strokeWidth={1.8} className="absolute inset-0 fill-[#E7E7ED] text-[#E7E7ED]" />
          <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: (Math.max(0, Math.min(1, rating - index)) * 100) + "%" }}>
            <Star size={size} strokeWidth={1.8} className="max-w-none fill-[#FF9500] text-[#FF9500]" />
          </span>
        </span>
      ))}
    </span>
  );
}

/** Listing ratings show a clearly labelled sample average; never a public rating claim. */
export function TemplateSampleInlineRating({ entry }: { entry: TemplateManifest }) {
  const score = sampleTemplateRating(entry);
  return (
    <span className="mt-1 inline-flex max-w-full items-center gap-1.5 text-[12px] text-[#65656B]" title="Illustrative sample reviews, not real user ratings">
      <Stars rating={score.average} size={12} />
      <span className="tabular-nums">{score.average.toFixed(1)}</span>
      <span>sample</span>
    </span>
  );
}

export function TemplateRatingGlance({ entry }: { entry: TemplateManifest }) {
  const { review } = useLocalReview(entry.id);
  const sample = sampleTemplateRating(entry);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6E6E73]" aria-label="Template rating preview">
      <Stars rating={sample.average} size={13} />
      <span>{sample.average.toFixed(1)} · Sample average, not customer ratings</span>
      {review ? <span>· Your rating: {review.rating}/5</span> : null}
      <span aria-hidden="true" className="h-3 w-px bg-black/10" />
      <span>{entry.sourceScreenshots.length} {entry.sourceScreenshots.length === 1 ? "source preview" : "source previews"}</span>
    </div>
  );
}

/** Screenshot lightbox: only genuine manifest captures, with provenance and full keyboard controls. */
export function TemplateScreenshotGallery({ entry }: { entry: TemplateManifest }) {
  const [active, setActive] = useState<number | null>(null);
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<typeof discoverOfficialScreenshots>>>([]);
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setDiscovered([]);
    setFailed([]);
    void discoverOfficialScreenshots(entry.repositoryUrl).then((images) => {
      if (!cancelled) setDiscovered(images);
    });
    return () => { cancelled = true; };
  }, [entry.repositoryUrl]);
  const screenshots = [...entry.sourceScreenshots, ...discovered]
    .filter((shot) => Boolean(shot.url && shot.alt && shot.provenance) && !failed.includes(shot.url))
    .filter((shot, index, all) => all.findIndex((other) => other.url === shot.url) === index);
  useEffect(() => { setActive(null); }, [entry.id]);
  useEffect(() => {
    if (active === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
      if (event.key === "ArrowRight") setActive((v) => v === null ? null : (v + 1) % screenshots.length);
      if (event.key === "ArrowLeft") setActive((v) => v === null ? null : (v - 1 + screenshots.length) % screenshots.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, screenshots.length]);

  return (
    <section className="mt-8" aria-labelledby="template-preview-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="template-preview-title" className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Preview</h3>
        {screenshots.length > 0 && <span className="text-[12px] text-[#86868B]">{screenshots.length} source {screenshots.length === 1 ? "preview" : "previews"}</span>}
      </div>
      {screenshots.length ? (
        <>
          <div className="cc-scroll mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]" aria-label={entry.name + " screenshots"}>
            {screenshots.map((shot, i) => (
              <figure key={shot.url + i} className="w-[min(590px,89%)] shrink-0 snap-start">
                <button type="button" onClick={() => setActive(i)} aria-label={"Enlarge screenshot " + (i + 1) + ": " + shot.alt}
                  className="group block w-full overflow-hidden rounded-[14px] bg-[#F5F5F7] outline-none ring-1 ring-inset ring-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#007AFF]">
                  <img src={shot.url} alt={shot.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="aspect-[16/10] w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]" onError={() => setFailed((current) => current.includes(shot.url) ? current : [...current, shot.url])} />
                </button>
                <figcaption className="mt-2 truncate text-[11.5px] text-[#86868B]" title={shot.provenance}>{shot.alt}</figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[#86868B]">These are actual images referenced by the upstream project’s README, not screenshots of a running Clyra installation. Some repositories may provide fewer than three suitable UI images.</p>
        </>
      ) : (
        <div className="mt-3 flex min-h-[166px] flex-col items-center justify-center rounded-[14px] border border-dashed border-black/[0.11] bg-[#FAFAFB] px-5 text-center">
          <ImageIcon className="h-6 w-6 text-[#B1B1B8]" strokeWidth={1.6} aria-hidden="true" />
          <p className="mt-3 text-[14px] font-medium text-[#424245]">No source previews available</p>
          <p className="mt-1 max-w-[420px] text-[12px] leading-[1.55] text-[#86868B]">No genuine interface screenshots were found in the available upstream README. Open the source repository or run a local checkout to capture the app’s actual interface.</p>
          <a href={entry.repositoryUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[#007AFF] hover:underline">View source <ExternalLink className="h-3 w-3" /></a>
        </div>
      )}
      {active !== null && screenshots[active] && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={"Screenshot " + (active + 1) + " of " + screenshots.length} onClick={() => setActive(null)}>
          <button type="button" aria-label="Close screenshot" onClick={() => setActive(null)} className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><X className="h-5 w-5" /></button>
          <button type="button" aria-label="Previous screenshot" onClick={(event) => { event.stopPropagation(); setActive((active - 1 + screenshots.length) % screenshots.length); }} className="absolute left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><ArrowLeft className="h-5 w-5" /></button>
          <div className="flex max-h-full max-w-[95%] flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
            <img src={screenshots[active].url} alt={screenshots[active].alt} className="max-h-[78vh] max-w-full rounded-[10px] object-contain" referrerPolicy="no-referrer" />
            <p className="text-center text-[12px] text-white/80">{active + 1} / {screenshots.length} · {screenshots[active].alt}</p>
            <p className="max-w-[680px] truncate text-[11px] text-white/50">{screenshots[active].provenance}</p>
          </div>
          <button type="button" aria-label="Next screenshot" onClick={(event) => { event.stopPropagation(); setActive((active + 1) % screenshots.length); }} className="absolute right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><ArrowRight className="h-5 w-5" /></button>
        </div>
      )}
    </section>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-black/[0.07] py-3 sm:flex-row sm:gap-6">
      <dt className="w-full shrink-0 text-[12px] text-[#86868B] sm:w-[160px]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[12.5px] leading-[1.55] text-[#303034]">{value}</dd>
    </div>
  );
}

export function TemplateFeaturesAndRequirements({ entry }: { entry: TemplateManifest }) {
  const knownCommands = (commands: string[]) => commands.length ? commands.join(" · ") : "Not yet verified";
  return (
    <>
      <section className="mt-8 border-t border-black/[0.08] pt-5" aria-label="Template features">
        <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Features</h3>
        {entry.capabilitiesVerified.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-[12px] font-semibold text-[#6E6E73]">Verified in Clyra</h4>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {entry.capabilitiesVerified.map((feature, i) => <li key={feature + i} className="flex items-start gap-2 text-[13px] leading-[1.55] text-[#303034]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />{feature}</li>)}
            </ul>
          </div>
        ) : <p className="mt-2 text-[12.5px] text-[#86868B]">No features have been verified by a Clyra runtime test yet.</p>}
        {entry.capabilitiesPlanned.length > 0 && (
          <div className="mt-4">
            <h4 className="text-[12px] font-semibold text-[#6E6E73]">Upstream-described capabilities · not verified in Clyra</h4>
            <ul className="mt-2 space-y-2">
              {entry.capabilitiesPlanned.map((feature, i) => <li key={feature + i} className="flex items-start gap-2 text-[13px] leading-[1.6] text-[#424245]"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#86868B]" />{feature}</li>)}
            </ul>
          </div>
        )}
        {entry.alternativeTo.length > 0 && <p className="mt-4 text-[12px] leading-[1.5] text-[#86868B]">Comparable products: {entry.alternativeTo.join(", ")}. Comparison does not imply feature parity or affiliation.</p>}
      </section>
      <section className="mt-8 border-t border-black/[0.08] pt-5" aria-label="Technical requirements">
        <div className="flex items-center gap-2">
          <h3 className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Technical requirements</h3>
        </div>
        <p className="mt-1.5 max-w-[710px] text-[12px] leading-[1.5] text-[#86868B]">Catalogue metadata is preliminary until the exact source revision and dependency files are inspected. An empty field does not mean no requirement exists.</p>
        <dl className="mt-3">
          <DetailLine label="Status" value={entry.status === "runnable-now" ? "Runnable now (catalogue status)" : entry.status.replace(/-/g, " ") + " · verify before use"} />
          <DetailLine label="Platforms / targets" value={entry.supportedTargets.join(", ") || "Not documented"} />
          <DetailLine label="Technology" value={entry.stack.join(", ") || "Not documented"} />
          <DetailLine label="API keys / secrets" value={entry.requiredSecrets.length ? entry.requiredSecrets.join(", ") : "Not audited. Check the upstream environment examples and README."} />
          <DetailLine label="Backend" value={entry.requiresBackend ? "Backend/runtime indicated by catalogue; inspect service setup." : "Not flagged by catalogue; backend requirements are not verified."} />
          <DetailLine label="Native build" value={entry.requiresNativeBuild ? "Native or desktop build indicated; review toolchain." : "Not flagged; native dependencies not verified."} />
          <DetailLine label="Build footprint" value={entry.estimatedBuildFootprint || "Not measured"} />
          <DetailLine label="Development command" value={entry.devCommand || "Not yet verified"} />
          <DetailLine label="Build commands" value={knownCommands(entry.buildCommands)} />
          <DetailLine label="Test commands" value={knownCommands(entry.testCommands)} />
          <DetailLine label="Port / healthcheck" value={entry.port ? String(entry.port) + " / " + (entry.healthcheck || "Not documented") : "Not yet verified"} />
          <DetailLine label="Deployment" value={entry.deployModes.join(", ") || "Not assessed"} />
          <DetailLine label="Verification date" value={entry.lastVerifiedAt ? new Date(entry.lastVerifiedAt).toLocaleDateString() : "Never verified in this catalogue"} />
        </dl>
        {entry.warnings.length > 0 && (
          <div className="mt-4 border-l-2 border-[#E5A146] pl-3">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#876437]"><CircleAlert className="h-4 w-4" /> Before installing</div>
            <ul className="mt-2 space-y-1.5 text-[12px] leading-[1.5] text-[#6E6E73]">
              {entry.warnings.map((warning, i) => <li key={warning + i}>{warning}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-[#86868B]">
          <span className="inline-flex items-center gap-1"><Monitor className="h-3.5 w-3.5" /> {entry.supportedTargets.length ? "Target data available" : "Targets unverified"}</span>
          <span className="inline-flex items-center gap-1"><Server className="h-3.5 w-3.5" /> Setup depends on upstream code</span>
          <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" /> No secrets are displayed</span>
        </div>
      </section>
    </>
  );
}

export function TemplateRatingsAndReviews({ entry, canReview }: { entry: TemplateManifest; canReview: boolean }) {
  const { review, save } = useLocalReview(entry.id);
  const previews = sampleTemplateReviews(entry);
  const summary = sampleTemplateRating(entry);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setEditing(false);
    setRating(0);
    setTitle("");
    setBody("");
    setError("");
  }, [entry.id]);
  useEffect(() => { if (!canReview) setEditing(false); }, [canReview]);

  const start = () => {
    if (!canReview) return;
    setRating(review?.rating ?? 0);
    setTitle(review?.title ?? "");
    setBody(review?.body ?? "");
    setError("");
    setEditing(true);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canReview) { setError("Get the template before writing a review."); return; }
    if (!rating) { setError("Choose a star rating."); return; }
    if (title.trim().length < 3 || body.trim().length < 10) { setError("Add a title (3+ characters) and review (10+ characters)."); return; }
    const ok = save({ rating, title: title.trim().slice(0, 80), body: body.trim().slice(0, 1000), updatedAt: new Date().toISOString() });
    if (!ok) { setError("This device could not save the review. Check local storage permissions."); return; }
    setEditing(false);
    setError("");
  };
  return (
    <section id={"template-ratings-" + entry.id} className="mt-8 scroll-mt-12 border-t border-black/[0.08] pt-5" aria-labelledby="template-reviews-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="template-reviews-title" className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Ratings & Reviews</h3>
        {canReview ? (
          <button type="button" onClick={start} className="text-[12.5px] font-medium text-[#007AFF] hover:underline">{review ? "Edit your review" : "Write a Review"}</button>
        ) : <span className="text-[12px] text-[#86868B]">Get this app to leave a rating</span>}
      </div>
      <p className="mt-1.5 max-w-[720px] text-[12px] leading-[1.55] text-[#86868B]">
        Illustrative example reviews only — these are not written by customers. The sample average below excludes your real on-device review.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-8">
        <div className="min-w-[142px]">
          <div className="flex items-end gap-2">
            <p className="text-[52px] font-semibold leading-none tracking-[-0.055em] tabular-nums text-[#424245]">{summary.average.toFixed(1)}</p>
            <span className="pb-1 text-[12px] text-[#86868B]">of 5</span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-[#86868B]">Sample average</p>
          <div className="mt-2"><Stars rating={summary.average} size={14} /></div>
        </div>
        <div className="w-full max-w-[370px] flex-1 space-y-1.5" aria-label="Illustrative sample rating distribution">
          {([5, 4, 3, 2, 1] as const).map((stars) => (
            <div key={stars} className="flex items-center gap-2 text-[11px] text-[#86868B]">
              <span className="w-2.5 text-right tabular-nums">{stars}</span>
              <Star className="h-2.5 w-2.5 fill-[#86868B] text-[#86868B]" aria-hidden="true" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E8E8ED]">
                <div className="h-full rounded-full bg-[#86868B] transition-[width] duration-300" style={{ width: (100 * summary.distribution[stars] / summary.count) + "%" }} />
              </div>
              <span className="w-3 text-right tabular-nums">{summary.distribution[stars]}</span>
            </div>
          ))}
          <p className="pt-1 text-right text-[11px] text-[#86868B]">{summary.count} illustrative sample ratings</p>
        </div>
      </div>

      <div className="cc-scroll mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label={entry.name + " sample review cards"}>
        {previews.map((item) => (
          <article key={item.id} className="w-[min(295px,86%)] shrink-0 snap-start rounded-[13px] bg-[#F5F5F7] p-4 sm:w-[310px]">
            <div className="flex items-center justify-between gap-2">
              <Stars rating={item.rating} size={12} />
              <span className="text-[10.5px] font-medium text-[#86868B]">Sample · Not a user review</span>
            </div>
            <h4 className="mt-3 line-clamp-2 text-[13.5px] font-semibold leading-[1.3] text-[#1D1D1F]">{item.title}</h4>
            <p className="mt-1.5 text-[12px] leading-[1.55] text-[#52525A]">{item.body}</p>
          </article>
        ))}
      </div>

      <div className="mt-7 border-t border-black/[0.08] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-[15px] font-semibold tracking-[-0.015em] text-[#1D1D1F]">Your rating</h4>
            <p className="mt-1 text-[11.5px] text-[#86868B]">{canReview ? "Your feedback is saved to this device, not published or counted in the sample average." : "Download this source with Get to unlock your review."}</p>
          </div>
          {canReview && !editing && <button type="button" onClick={start} className="rounded-full bg-[#F0F0F5] px-3.5 py-2 text-[12px] font-semibold text-[#007AFF] hover:bg-[#E5E5EA]">{review ? "Edit rating" : "Rate this app"}</button>}
        </div>
        {review && !editing && (
          <div className="mt-4 max-w-[570px] rounded-[13px] border border-black/[0.08] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Stars rating={review.rating} size={14} />
              <time className="text-[11px] text-[#86868B]" dateTime={review.updatedAt}>{new Date(review.updatedAt).toLocaleDateString()}</time>
            </div>
            <p className="mt-2 text-[13.5px] font-semibold text-[#303034]">{review.title}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-[#515157]">{review.body}</p>
            <div className="mt-3 flex items-center gap-4">
              <span className="text-[11px] text-[#86868B]">You · On this device</span>
              {canReview && <button type="button" onClick={() => { if (!save(null)) setError("Could not remove the review."); }} className="text-[11.5px] text-[#007AFF] hover:underline">Delete</button>}
            </div>
          </div>
        )}
        {!review && !editing && !canReview && <p className="mt-3 text-[12px] text-[#86868B]">Get the template first. You can rate it as soon as the download completes.</p>}
        {editing && canReview && (
          <form onSubmit={submit} className="mt-5 max-w-[560px] space-y-3">
            <fieldset>
              <legend className="mb-2 text-[12px] font-medium text-[#424245]">Tap a star to rate</legend>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button key={value} type="button" aria-label={"Rate " + value + (value === 1 ? " star" : " stars")} aria-pressed={rating === value} onClick={() => setRating(value)}
                    className="rounded-[6px] p-1.5 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#007AFF]/50">
                    <Star className={"h-6 w-6 " + (value <= rating ? "fill-[#FF9500] text-[#FF9500]" : "fill-[#E8E8ED] text-[#D6D6DC]")} />
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-[12px] font-medium text-[#424245]">Review title
              <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Summarise your experience" className="mt-1.5 block h-9 w-full rounded-[9px] border border-black/[0.13] bg-white px-3 text-[13px] font-normal outline-none focus:border-[#007AFF]" />
            </label>
            <label className="block text-[12px] font-medium text-[#424245]">Your review
              <textarea value={body} maxLength={1000} onChange={(event) => setBody(event.target.value)} placeholder="What worked well? What would you improve?" rows={4} className="mt-1.5 block w-full resize-y rounded-[9px] border border-black/[0.13] bg-white px-3 py-2 text-[13px] font-normal leading-[1.5] outline-none focus:border-[#007AFF]" />
            </label>
            {error && <p role="alert" className="text-[12px] text-[#B14538]">{error}</p>}
            <div className="flex items-center gap-3">
              <button type="submit" className="rounded-full bg-[#007AFF] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[#0066DB]">Save review</button>
              <button type="button" onClick={() => { setEditing(false); setError(""); }} className="text-[12px] text-[#6E6E73] hover:text-[#1D1D1F]">Cancel</button>
            </div>
            <p className="text-[11px] leading-[1.5] text-[#86868B]">Stored only on this device. Clyra does not publish or sync this feedback.</p>
          </form>
        )}
        {error && !editing && <p role="alert" className="mt-2 text-[12px] text-[#B14538]">{error}</p>}
      </div>
    </section>
  );
}
