/**
 * Test-user seeder — DEV ONLY.
 *
 * Creates a fixed roster of fake users (Alice, Bob, Camille, Diego, Emma) plus
 * a body of fake recent activities, UserStats, and FeedEvent rows so the feed
 * and profile screens have realistic data to render.
 *
 *   npm run db:seed:test-users
 *
 * To also pre-populate friendship rows against one of your real users (so
 * each tab has something to look at, and the feed surfaces Alice's activities
 * since she's your friend):
 *
 *   npm run db:seed:test-users -- --for-user-id=1
 *
 * That seeds:
 *   - Alice  → ACCEPTED   (Friends tab; her activities appear in your feed)
 *   - Bob    → PENDING incoming (Requests tab)
 *   - Camille → PENDING outgoing (Sent tab)
 *   - Diego, Emma → no relationship (search them to send a request)
 *
 * To wipe the test users (and their activities / feed rows / friendships):
 *
 *   npm run db:seed:test-users -- --clean
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TestUser {
  /** Use a high stable Strava ID to avoid colliding with real athletes. */
  stravaId: number;
  firstname: string;
  lastname: string;
  /** Deterministic avatar from dicebear so the UI has something to render. */
  avatarSeed: string;
  /** Affects which activity types we generate (more realistic per-user). */
  profile: 'runner' | 'cyclist' | 'hiker' | 'mixed';
}

const TEST_USERS: TestUser[] = [
  { stravaId: 9000001, firstname: 'Alice', lastname: 'Martin', avatarSeed: 'alice', profile: 'runner' },
  { stravaId: 9000002, firstname: 'Bob', lastname: 'Carter', avatarSeed: 'bob', profile: 'cyclist' },
  { stravaId: 9000003, firstname: 'Camille', lastname: 'Dubois', avatarSeed: 'camille', profile: 'hiker' },
  { stravaId: 9000004, firstname: 'Diego', lastname: 'Rivera', avatarSeed: 'diego', profile: 'mixed' },
  { stravaId: 9000005, firstname: 'Emma', lastname: 'Wilson', avatarSeed: 'emma', profile: 'runner' },
];

// ---------- helpers ----------

function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`;
}

/**
 * Tiny seeded PRNG so each test user gets a stable, reproducible activity log
 * across runs. Mulberry32 — fast, good enough for fake data.
 */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);
const intBetween = (rng: () => number, lo: number, hi: number): number => Math.floor(between(rng, lo, hi + 1));

interface ActivityTemplate {
  type: string; // Strava `type`
  sportType: string;
  weight: number;
  distance: [number, number]; // meters
  speed: [number, number]; // m/s
  elevationPerKm: [number, number]; // meters per km of distance
  hr?: [number, number];
  names: readonly string[];
}

const TEMPLATES: Record<TestUser['profile'], ActivityTemplate[]> = {
  runner: [
    {
      type: 'Run',
      sportType: 'Run',
      weight: 6,
      distance: [4_000, 18_000],
      speed: [2.7, 4.2],
      elevationPerKm: [3, 25],
      hr: [135, 175],
      names: ['Morning run', 'Lunch loop', 'Easy recovery', 'Tempo run', 'Park laps', 'Evening shakeout'],
    },
    {
      type: 'Run',
      sportType: 'TrailRun',
      weight: 2,
      distance: [8_000, 22_000],
      speed: [2.4, 3.6],
      elevationPerKm: [15, 60],
      hr: [140, 178],
      names: ['Trail adventure', 'Forest miles', 'Singletrack ramble'],
    },
    {
      type: 'Walk',
      sportType: 'Walk',
      weight: 1,
      distance: [2_000, 6_000],
      speed: [1.1, 1.5],
      elevationPerKm: [2, 12],
      names: ['Cooldown walk', 'Coffee stroll'],
    },
  ],
  cyclist: [
    {
      type: 'Ride',
      sportType: 'Ride',
      weight: 5,
      distance: [25_000, 110_000],
      speed: [6.5, 10.5],
      elevationPerKm: [4, 25],
      hr: [115, 160],
      names: ['Weekend ride', 'Café spin', 'After-work loop', 'Long ride', 'Group ride', 'Hill route'],
    },
    {
      type: 'Ride',
      sportType: 'MountainBikeRide',
      weight: 2,
      distance: [15_000, 45_000],
      speed: [4.5, 7.0],
      elevationPerKm: [20, 60],
      hr: [125, 170],
      names: ['MTB session', 'Forest trails', 'Singletrack hunt'],
    },
    {
      type: 'Run',
      sportType: 'Run',
      weight: 1,
      distance: [3_000, 8_000],
      speed: [2.5, 3.4],
      elevationPerKm: [2, 12],
      hr: [130, 165],
      names: ['Cross-training run'],
    },
  ],
  hiker: [
    {
      type: 'Hike',
      sportType: 'Hike',
      weight: 5,
      distance: [6_000, 22_000],
      speed: [0.8, 1.4],
      elevationPerKm: [30, 90],
      names: ['Mountain hike', 'Ridge walk', 'Summit attempt', 'Forest hike', 'Sunday hike'],
    },
    {
      type: 'Walk',
      sportType: 'Walk',
      weight: 3,
      distance: [3_000, 9_000],
      speed: [1.0, 1.5],
      elevationPerKm: [5, 20],
      names: ['Town walk', 'Coastal walk', 'Park loop'],
    },
  ],
  mixed: [
    {
      type: 'Run',
      sportType: 'Run',
      weight: 3,
      distance: [5_000, 14_000],
      speed: [2.8, 4.0],
      elevationPerKm: [4, 20],
      hr: [135, 175],
      names: ['Run', 'Track session', 'Lunchtime miles'],
    },
    {
      type: 'Ride',
      sportType: 'Ride',
      weight: 3,
      distance: [20_000, 70_000],
      speed: [6.0, 9.5],
      elevationPerKm: [5, 25],
      hr: [115, 158],
      names: ['Road ride', 'Evening spin'],
    },
    {
      type: 'Swim',
      sportType: 'Swim',
      weight: 2,
      distance: [1_000, 2_500],
      speed: [0.8, 1.4],
      elevationPerKm: [0, 0],
      names: ['Pool session', 'Open-water swim'],
    },
  ],
};

function weightedPick(rng: () => number, templates: ActivityTemplate[]): ActivityTemplate {
  const total = templates.reduce((sum, t) => sum + t.weight, 0);
  let r = rng() * total;
  for (const t of templates) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return templates[templates.length - 1];
}

interface GeneratedActivity {
  id: bigint;
  name: string;
  type: string;
  sportType: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  startDate: Date;
  startDateLocal: Date;
  averageSpeed: number;
  maxSpeed: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  kudosCount: number;
  commentCount: number;
  photoCount: number;
  prCount: number;
  summaryPolyline: string;
}

/**
 * Minimal Google polyline encoder so seeded activities ship with route shapes
 * the feed can render as SVG. We never reverse this — the encoded string is
 * shape-only, not real geography.
 */
function encodePolyline(points: Array<[number, number]>): string {
  let result = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    result += encodeSignedNumber(latE5 - prevLat) + encodeSignedNumber(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return result;
}

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  let result = '';
  while (sgnNum >= 0x20) {
    result += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>>= 5;
  }
  result += String.fromCharCode(sgnNum + 63);
  return result;
}

/**
 * Generate a fake route shape — a loop with random vertices, deterministic
 * per (rng, seed). Gives every activity a unique recognisable squiggle.
 */
function generateFakeRoute(rng: () => number): string {
  const cx = 0;
  const cy = 0;
  const pointCount = 40 + Math.floor(rng() * 30);
  const baseRadius = 0.003 + rng() * 0.008;
  const wobbleAmp = 0.4 + rng() * 0.6;
  const phaseShift = rng() * Math.PI * 2;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2 + phaseShift;
    const wobble = 1 + Math.sin(angle * 3 + phaseShift) * wobbleAmp * 0.3;
    const r = baseRadius * wobble;
    const lat = cy + Math.sin(angle) * r + (rng() - 0.5) * baseRadius * 0.1;
    const lng = cx + Math.cos(angle) * r + (rng() - 0.5) * baseRadius * 0.1;
    points.push([lat, lng]);
  }
  return encodePolyline(points);
}

const ACTIVITIES_PER_USER = 12;
const ACTIVITY_WINDOW_DAYS = 90;

function generateActivities(user: TestUser): GeneratedActivity[] {
  const rng = makeRng(user.stravaId);
  const templates = TEMPLATES[user.profile];
  const out: GeneratedActivity[] = [];
  const now = Date.now();

  for (let i = 0; i < ACTIVITIES_PER_USER; i++) {
    const tpl = weightedPick(rng, templates);
    const distance = Math.round(between(rng, tpl.distance[0], tpl.distance[1]));
    const averageSpeed = between(rng, tpl.speed[0], tpl.speed[1]);
    const movingTime = Math.round(distance / averageSpeed);
    const elapsedTime = movingTime + intBetween(rng, 0, Math.round(movingTime * 0.08));
    const totalElevationGain = Math.round((distance / 1000) * between(rng, tpl.elevationPerKm[0], tpl.elevationPerKm[1]));
    const maxSpeed = averageSpeed * between(rng, 1.15, 1.55);
    const hr = tpl.hr ? { avg: between(rng, tpl.hr[0], tpl.hr[1]), max: 0 } : null;
    if (hr) hr.max = hr.avg + between(rng, 10, 25);

    // Spread over the window, weighted slightly toward more recent days.
    const daysAgo = Math.floor(ACTIVITY_WINDOW_DAYS * Math.pow(rng(), 1.4));
    const startDate = new Date(now - daysAgo * 86400_000 - intBetween(rng, 0, 86400_000));

    out.push({
      // Deterministic high BigInt id keyed off Strava id + index so re-running
      // the seed upserts the same activities (no duplicates).
      id: 999_000_000_000n + BigInt(user.stravaId) * 1000n + BigInt(i),
      name: pick(rng, tpl.names),
      type: tpl.type,
      sportType: tpl.sportType,
      distance,
      movingTime,
      elapsedTime,
      totalElevationGain,
      startDate,
      startDateLocal: startDate,
      averageSpeed,
      maxSpeed,
      averageHeartrate: hr ? Math.round(hr.avg) : null,
      maxHeartrate: hr ? Math.round(hr.max) : null,
      kudosCount: intBetween(rng, 0, 18),
      commentCount: rng() < 0.25 ? intBetween(rng, 1, 4) : 0,
      photoCount: rng() < 0.2 ? intBetween(rng, 1, 5) : 0,
      // ~1 in 6 activities is a PR — celebrated visually on the card.
      prCount: rng() < 0.15 ? 1 : 0,
      summaryPolyline: generateFakeRoute(rng),
    });
  }

  return out;
}

// ---------- DB operations ----------

async function cleanTestUsers(): Promise<void> {
  const stravaIds = TEST_USERS.map((u) => u.stravaId);
  const result = await prisma.user.deleteMany({
    where: { stravaId: { in: stravaIds } },
  });
  // Activities, friendships, feed events, stats all cascade-delete via the
  // user FK, so no extra cleanup needed.
  console.log(`🧹 Removed ${result.count} test users (cascade-deleted activities, feed events, stats, friendships).`);
}

async function upsertTestUsers(): Promise<Map<string, number>> {
  const idByAvatarSeed = new Map<string, number>();
  for (const u of TEST_USERS) {
    const profile = avatarUrl(u.avatarSeed);
    const record = await prisma.user.upsert({
      where: { stravaId: u.stravaId },
      create: {
        stravaId: u.stravaId,
        firstname: u.firstname,
        lastname: u.lastname,
        profile,
        profileMedium: profile,
        accessToken: 'TEST_USER_NO_TOKEN',
        refreshToken: 'TEST_USER_NO_TOKEN',
        tokenExpiresAt: BigInt(0),
        lastSyncedAt: new Date(),
      },
      update: {
        firstname: u.firstname,
        lastname: u.lastname,
        profile,
        profileMedium: profile,
        lastSyncedAt: new Date(),
      },
    });
    idByAvatarSeed.set(u.avatarSeed, record.id);
    console.log(`   ✅ ${u.firstname} ${u.lastname} (id=${record.id}, stravaId=${u.stravaId})`);
  }
  return idByAvatarSeed;
}

/**
 * Build a fake Strava-shaped photo URL map keyed by max-pixel size. We use
 * picsum.photos with a deterministic seed so the same activity always shows
 * the same image (re-running the seed is stable).
 */
function fakePhotoUrls(activityId: bigint, photoIdx: number): Record<string, string> {
  const seed = `${activityId.toString()}-${photoIdx}`;
  return {
    '100': `https://picsum.photos/seed/${seed}/100/100`,
    '600': `https://picsum.photos/seed/${seed}/600/400`,
    '2048': `https://picsum.photos/seed/${seed}/2048/1365`,
  };
}

async function seedActivitiesAndFeedFor(user: TestUser, userId: number): Promise<{ count: number }> {
  const activities = generateActivities(user);

  // Wipe any prior feed events for this user so we don't double-emit on re-run.
  await prisma.feedEvent.deleteMany({
    where: { actorId: userId, type: 'activity_posted' },
  });

  // Wipe any prior fake photos for these activities so re-runs are deterministic.
  await prisma.activityPhoto.deleteMany({
    where: { activityId: { in: activities.map((a) => a.id) } },
  });

  // Upsert activities (idempotent).
  for (const a of activities) {
    await prisma.activity.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        userId,
        name: a.name,
        type: a.type,
        sportType: a.sportType,
        distance: a.distance,
        movingTime: a.movingTime,
        elapsedTime: a.elapsedTime,
        totalElevationGain: a.totalElevationGain,
        startDate: a.startDate,
        startDateLocal: a.startDateLocal,
        averageSpeed: a.averageSpeed,
        maxSpeed: a.maxSpeed,
        averageHeartrate: a.averageHeartrate,
        maxHeartrate: a.maxHeartrate,
        kudosCount: a.kudosCount,
        commentCount: a.commentCount,
        photoCount: a.photoCount,
        achievementCount: 0,
        prCount: a.prCount,
        summaryPolyline: a.summaryPolyline,
        timezone: '(GMT+01:00) Europe/Paris',
      },
      update: {
        name: a.name,
        distance: a.distance,
        movingTime: a.movingTime,
        elapsedTime: a.elapsedTime,
        totalElevationGain: a.totalElevationGain,
        startDate: a.startDate,
        startDateLocal: a.startDateLocal,
        averageSpeed: a.averageSpeed,
        maxSpeed: a.maxSpeed,
        averageHeartrate: a.averageHeartrate,
        maxHeartrate: a.maxHeartrate,
        kudosCount: a.kudosCount,
        commentCount: a.commentCount,
        photoCount: a.photoCount,
        prCount: a.prCount,
        summaryPolyline: a.summaryPolyline,
      },
    });
  }

  // Insert ActivityPhoto rows for activities whose generator decided they have
  // photos. URLs are picsum.photos (stable per activity, deterministic).
  const photoRows = activities.flatMap((a) =>
    Array.from({ length: a.photoCount }, (_, i) => ({
      uniqueId: `test-${a.id.toString()}-${i}`,
      activityId: a.id,
      caption: null,
      urls: fakePhotoUrls(a.id, i),
      defaultPhoto: i === 0,
      takenAt: a.startDate,
    }))
  );
  if (photoRows.length > 0) {
    await prisma.activityPhoto.createMany({ data: photoRows, skipDuplicates: true });
  }

  // Emit a FeedEvent per activity, dated to the activity's startDate so the
  // feed orders correctly. This is the exact shape real sync will emit later.
  await prisma.feedEvent.createMany({
    data: activities.map((a) => ({
      actorId: userId,
      type: 'activity_posted',
      entityType: 'activity',
      entityId: a.id.toString(),
      metadata: {
        name: a.name,
        type: a.type,
        distance: a.distance,
        movingTime: a.movingTime,
        totalElevationGain: a.totalElevationGain,
        averageSpeed: a.averageSpeed,
      },
      createdAt: a.startDate,
    })),
  });

  // Re-derive UserStats aggregate so the profile screen reflects the fake data.
  const totals = activities.reduce(
    (acc, a) => {
      acc.totalDistance += a.distance;
      acc.totalElevation += a.totalElevationGain;
      acc.totalTime += a.movingTime;
      return acc;
    },
    { totalDistance: 0, totalElevation: 0, totalTime: 0 }
  );

  await prisma.userStats.upsert({
    where: { userId },
    create: {
      userId,
      totalActivities: activities.length,
      totalDistance: totals.totalDistance,
      totalElevation: totals.totalElevation,
      totalTime: totals.totalTime,
      currentStreak: 0,
      longestStreak: 0,
    },
    update: {
      totalActivities: activities.length,
      totalDistance: totals.totalDistance,
      totalElevation: totals.totalElevation,
      totalTime: totals.totalTime,
    },
  });

  return { count: activities.length };
}

async function seedFriendshipsFor(targetUserId: number, idByAvatarSeed: Map<string, number>): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) {
    throw new Error(`User id=${targetUserId} not found — pass an existing real user id.`);
  }

  const alice = idByAvatarSeed.get('alice')!;
  const bob = idByAvatarSeed.get('bob')!;
  const camille = idByAvatarSeed.get('camille')!;

  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: { in: [alice, bob, camille] }, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: { in: [alice, bob, camille] } },
      ],
    },
  });

  await prisma.friendship.create({
    data: { requesterId: alice, addresseeId: targetUserId, status: 'ACCEPTED', acceptedAt: new Date() },
  });
  await prisma.friendship.create({
    data: { requesterId: bob, addresseeId: targetUserId, status: 'PENDING' },
  });
  await prisma.friendship.create({
    data: { requesterId: targetUserId, addresseeId: camille, status: 'PENDING' },
  });

  console.log(`\n🔗 Friendship rows seeded for user id=${targetUserId}:`);
  console.log(`   • Alice    → ACCEPTED  (Friends tab; her activities appear in your feed)`);
  console.log(`   • Bob      → PENDING incoming  (Requests tab)`);
  console.log(`   • Camille  → PENDING outgoing  (Sent tab)`);
  console.log(`   • Diego, Emma → no relationship (try searching for them)`);
}

// ---------- main ----------

function parseArgs(): { forUserId?: number; clean: boolean } {
  const args = process.argv.slice(2);
  const result: { forUserId?: number; clean: boolean } = { clean: false };
  for (const arg of args) {
    if (arg === '--clean') {
      result.clean = true;
    } else if (arg.startsWith('--for-user-id=')) {
      result.forUserId = Number(arg.slice('--for-user-id='.length));
    }
  }
  return result;
}

async function main(): Promise<void> {
  const { forUserId, clean } = parseArgs();

  if (clean) {
    console.log('🧹 Cleaning test users…\n');
    await cleanTestUsers();
    return;
  }

  console.log('🌱 Seeding test users…\n');
  const idByAvatarSeed = await upsertTestUsers();

  console.log('\n🏃 Seeding activities + feed events + stats…');
  for (const user of TEST_USERS) {
    const userId = idByAvatarSeed.get(user.avatarSeed)!;
    const { count } = await seedActivitiesAndFeedFor(user, userId);
    console.log(`   ✅ ${user.firstname}: ${count} activities + feed events`);
  }

  if (forUserId !== undefined) {
    if (!Number.isInteger(forUserId) || forUserId <= 0) {
      throw new Error(`--for-user-id must be a positive integer, got: ${forUserId}`);
    }
    await seedFriendshipsFor(forUserId, idByAvatarSeed);
  } else {
    console.log(
      '\nℹ️  No --for-user-id given. Test users + their activities are in the DB.\n   ' +
        'Re-run with --for-user-id=<your user id> to pre-populate friendships so the feed has content.'
    );
  }

  console.log('\n✅ Done.');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
