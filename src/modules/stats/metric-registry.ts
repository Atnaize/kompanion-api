/**
 * A4 — Metric registry shared by the friends leaderboard (M4) and the
 * friend-compare (M5) endpoints. Adding a new metric is: new key + descriptor
 * here, then it shows up everywhere automatically.
 *
 * The registry consumes a {@link MetricAggregate} (per-user roll-up over a set
 * of activities) and produces a single numeric value plus a stable wire-format.
 */

export type MetricKey =
  | 'distance'
  | 'elevation'
  | 'count'
  | 'movingTime'
  | 'avgSpeed'
  | 'elevationPerKm';

export const METRIC_KEYS: readonly MetricKey[] = [
  'distance',
  'elevation',
  'count',
  'movingTime',
  'avgSpeed',
  'elevationPerKm',
] as const;

/**
 * Per-user aggregate over a filtered set of activities (period + activity type
 * already applied). All numeric fields are zero when the user has no matching
 * activities in the window.
 */
export interface MetricAggregate {
  userId: number;
  /** Sum of `Activity.distance` (meters). */
  sumDistance: number;
  /** Sum of `Activity.totalElevationGain` (meters). */
  sumElevation: number;
  /** Sum of `Activity.movingTime` (seconds). */
  sumMovingTime: number;
  /** Number of matching activities. */
  count: number;
  /** Most recent `startDateLocal` in the window. Null when count = 0. */
  latestStartDate: Date | null;
}

export interface MetricDescriptor {
  /** Pick the numeric value out of an aggregated row. */
  pick(row: MetricAggregate): number;
  /** Round for the wire. The API only ever returns values via this. */
  format(value: number): number;
  /** Frontend i18n key for the metric label. */
  labelKey: string;
  /**
   * Higher value ranks higher? True for all current metrics. Reserved for
   * future "fastest pace" / "lowest …" variants — keeps the leaderboard
   * sort orientation in the registry, not at the call site.
   */
  higherIsBetter: boolean;
}

export const METRIC_REGISTRY: Record<MetricKey, MetricDescriptor> = {
  distance: {
    pick: (r) => r.sumDistance,
    format: (v) => Math.round(v),
    labelKey: 'leaderboards.metric.distance',
    higherIsBetter: true,
  },
  elevation: {
    pick: (r) => r.sumElevation,
    format: (v) => Math.round(v),
    labelKey: 'leaderboards.metric.elevation',
    higherIsBetter: true,
  },
  count: {
    pick: (r) => r.count,
    format: (v) => Math.round(v),
    labelKey: 'leaderboards.metric.count',
    higherIsBetter: true,
  },
  movingTime: {
    pick: (r) => r.sumMovingTime,
    format: (v) => Math.round(v),
    labelKey: 'leaderboards.metric.movingTime',
    higherIsBetter: true,
  },
  // Effective average pace across the window: total distance / total time.
  // Per-activity averageSpeed values can't be averaged directly (would
  // mis-weight short vs. long efforts).
  avgSpeed: {
    pick: (r) => (r.sumMovingTime > 0 ? r.sumDistance / r.sumMovingTime : 0),
    format: (v) => Math.round(v * 100) / 100,
    labelKey: 'leaderboards.metric.avgSpeed',
    higherIsBetter: true,
  },
  elevationPerKm: {
    pick: (r) => (r.sumDistance > 0 ? r.sumElevation / (r.sumDistance / 1000) : 0),
    format: (v) => Math.round(v * 10) / 10,
    labelKey: 'leaderboards.metric.elevationPerKm',
    higherIsBetter: true,
  },
};

export type LeaderboardPeriod = 'week' | 'month' | 'year' | 'overall';

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = [
  'week',
  'month',
  'year',
  'overall',
] as const;

/**
 * Start date for a leaderboard window. Calendar-aligned (start of week/month/
 * year), mirroring `StatsService.calculateStatsForPeriod`. `overall` returns
 * null — caller omits the date filter entirely.
 */
export function startDateForPeriod(period: LeaderboardPeriod): Date | null {
  if (period === 'overall') {
    return null;
  }
  const now = new Date();
  switch (period) {
    case 'week': {
      const dayOfWeek = now.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const d = new Date(now);
      d.setDate(now.getDate() - daysFromMonday);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    case 'year':
      return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
}

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRIC_KEYS as readonly string[]).includes(value);
}

export function isLeaderboardPeriod(value: unknown): value is LeaderboardPeriod {
  return typeof value === 'string' && (LEADERBOARD_PERIODS as readonly string[]).includes(value);
}
