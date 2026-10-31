/** One easing curve and one set of durations for the whole assistant surface (seconds). */
export const AI_EASE = [0.22, 1, 0.36, 1] as const;

export const AI_DURATION = {
  response: 0.32,
  block: 0.24,
  statusOut: 0.12,
  statusIn: 0.24,
  source: 0.24,
  sourceStagger: 0.035,
  disclosureOpen: 0.22,
  disclosureClose: 0.18,
  chevron: 0.18,
  menuOpen: 0.16,
  menuClose: 0.12,
  editOpen: 0.18,
  editClose: 0.14,
} as const;
