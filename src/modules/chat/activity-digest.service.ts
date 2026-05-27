import { prisma } from '@shared/utils/index.js';
import type { Prisma } from '@prisma/client';
import type { DigestActivity, DigestPayload } from './chat.types.js';

/**
 * Append-on-same-day activity_digest writer.
 *
 * Behaviour: for each (challengeId, userId) batch of activities, find the
 * day's existing digest message in that challenge's conversation (keyed by
 * `localDate`) and append the new entries. If no digest exists for the day,
 * create one. We re-use a single message per day so the chat shows
 * "Bob, Alice +3 logged 5 runs today" as one card instead of N bubbles —
 * the user-requested mitigation against event spam.
 *
 * No notification fires from this path. The existing `challenge_activity_added`
 * push (in challenge.service syncActiveChallenges) covers the "X added Y
 * activities" signal — duplicating it as a chat notification would just spam.
 */
class ActivityDigestService {
  /**
   * Record one or more activities into today's digest for a challenge. Called
   * from the challenge sync path after rows have already been inserted into
   * `challenge_activities`. Bypasses the resolver's viewer-gate because this
   * is system-initiated; we still go through the resolver to get-or-create
   * the conversation.
   */
  async recordForChallenge(opts: {
    challengeId: string;
    activities: DigestActivity[];
  }): Promise<void> {
    if (opts.activities.length === 0) return;

    // System-initiated upsert: we need the conversation row regardless of any
    // particular user's membership status. The resolver's viewer-gating
    // helpers don't fit here, so we go direct.
    const conversation = await prisma.conversation.upsert({
      where: { challengeId: opts.challengeId },
      update: {},
      create: { kind: 'challenge', challengeId: opts.challengeId },
      select: { id: true },
    });

    // Group activities by their local-date string so a sync that spans
    // midnight produces two cards. `localDate` uses the activity's local
    // calendar day, matching how a user thinks about "today's runs".
    const groups = new Map<string, DigestActivity[]>();
    for (const a of opts.activities) {
      const day = localDateKey(a.recordedAt);
      const list = groups.get(day) ?? [];
      list.push(a);
      groups.set(day, list);
    }

    for (const [date, activities] of groups) {
      await this.upsertDigestForDay(conversation.id, date, activities);
    }
  }

  private async upsertDigestForDay(
    conversationId: string,
    date: string,
    newActivities: DigestActivity[]
  ): Promise<void> {
    // Window the search to the same calendar day in UTC; this matches the
    // (conversationId, kind, createdAt) index and keeps the read cheap.
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const existing = await prisma.message.findFirst({
      where: {
        conversationId,
        kind: 'activity_digest',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, payload: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!existing) {
      const payload: DigestPayload = { date, activities: newActivities };
      await prisma.message.create({
        data: {
          conversationId,
          authorId: null,
          kind: 'activity_digest',
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    // Append, dedup by activityId (so a re-run of the sync doesn't duplicate
    // an entry). Sort by recordedAt so the rendered list reads chronologically.
    const previous = (existing.payload as unknown as DigestPayload | null)?.activities ?? [];
    const seen = new Set(previous.map((a) => a.activityId));
    const merged: DigestActivity[] = [...previous];
    for (const a of newActivities) {
      if (!seen.has(a.activityId)) {
        merged.push(a);
        seen.add(a.activityId);
      }
    }
    merged.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    const payload: DigestPayload = { date, activities: merged };
    await prisma.message.update({
      where: { id: existing.id },
      data: {
        payload: payload as unknown as Prisma.InputJsonValue,
        editedAt: new Date(),
      },
    });
  }
}

function localDateKey(iso: string): string {
  // Activities carry an ISO timestamp at the *Strava* level. We use the
  // string's date prefix as the local-day key, which is correct because
  // the source data is `activity.startDateLocal` (already normalised to the
  // activity's local time). UTC-based prefixing would split workouts at the
  // wrong boundary for users near the date line.
  return iso.slice(0, 10);
}

export const activityDigestService = new ActivityDigestService();
