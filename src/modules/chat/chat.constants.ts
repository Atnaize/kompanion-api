// Allowlist of reactions exposed in the UI. Server rejects anything else with
// 400 — keeps the column free of arbitrary unicode and lets us evolve the set
// later without a DB schema change.
export const REACTION_EMOJIS = ['👍', '❤️', '🔥', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const PAGE_SIZE_DEFAULT = 30;
export const PAGE_SIZE_MAX = 100;

export const BODY_MIN = 1;
export const BODY_MAX = 2000;

// Push body preview cap — matches the WhatsApp-style truncated tail (`…`).
export const PREVIEW_MAX = 80;

export function truncatePreview(body: string, max = PREVIEW_MAX): string {
  return body.length > max ? `${body.slice(0, max - 3)}…` : body;
}
