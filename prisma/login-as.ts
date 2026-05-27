/**
 * "Log in as" helper — DEV ONLY.
 *
 * There is no impersonation endpoint: a real session is a Strava-OAuth login
 * that mints a JWT access token + a refresh-token row. Fake/test users can't
 * go through Strava, so this script forges the same pair for any existing user
 * and prints a login URL you can open in a second browser (or an incognito
 * window) to act as that user — accept/decline club & challenge invites, start
 * a challenge with a crew, chat, etc.
 *
 * List every user so you can pick one:
 *   npm run db:login-as
 *
 * Log in as a user (by name, db id, or Strava id):
 *   npm run db:login-as -- --name=Alice
 *   npm run db:login-as -- --user-id=7
 *   npm run db:login-as -- --strava-id=9000001
 *
 * Override the frontend origin (defaults to ALLOWED_ORIGINS[0]):
 *   npm run db:login-as -- --name=Alice --origin=http://localhost:5173
 *
 * The forged session is identical to a real one: the access token is signed
 * with SESSION_SECRET and the refresh token is a real DB row, so the PWA will
 * silently refresh it and the session persists like any other login.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, matches auth flow

interface Args {
  name?: string;
  userId?: number;
  stravaId?: number;
  origin?: string;
}

function parseArgs(): Args {
  const out: Args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--name=')) {
      out.name = arg.slice('--name='.length);
    } else if (arg.startsWith('--user-id=')) {
      out.userId = Number(arg.slice('--user-id='.length));
    } else if (arg.startsWith('--strava-id=')) {
      out.stravaId = Number(arg.slice('--strava-id='.length));
    } else if (arg.startsWith('--origin=')) {
      out.origin = arg.slice('--origin='.length);
    }
  }
  return out;
}

function frontendOrigin(override?: string): string {
  if (override) {
    return override.replace(/\/$/, '');
  }
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',')[0]?.trim();
  return (allowed || 'http://localhost:5173').replace(/\/$/, '');
}

async function listUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, firstname: true, lastname: true, stravaId: true, isAdmin: true },
  });

  if (users.length === 0) {
    console.log('No users in the DB yet. Run `npm run db:seed:test-users` first.');
    return;
  }

  console.log('\n👥 Users (pass one to --name / --user-id / --strava-id):\n');
  for (const u of users) {
    const isTest = u.stravaId >= 9_000_001 && u.stravaId <= 9_000_005;
    const tags = [u.isAdmin ? 'admin' : null, isTest ? 'test-user' : null].filter(Boolean).join(', ');
    console.log(
      `   id=${String(u.id).padEnd(4)} stravaId=${String(u.stravaId).padEnd(10)} ${u.firstname} ${u.lastname}` +
        (tags ? `  (${tags})` : '')
    );
  }
  console.log('\nThen: npm run db:login-as -- --name=Alice\n');
}

async function main(): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set — check your .env (the API signs JWTs with it).');
  }

  const args = parseArgs();

  if (args.name === undefined && args.userId === undefined && args.stravaId === undefined) {
    await listUsers();
    return;
  }

  let where: { id: number } | { stravaId: number } | { firstname: { equals: string; mode: 'insensitive' } };
  if (args.userId !== undefined) {
    where = { id: args.userId };
  } else if (args.stravaId !== undefined) {
    where = { stravaId: args.stravaId };
  } else {
    where = { firstname: { equals: args.name!, mode: 'insensitive' } };
  }

  const user = await prisma.user.findFirst({
    where,
    select: { id: true, stravaId: true, firstname: true, lastname: true, isAdmin: true },
  });

  if (!user) {
    throw new Error(`No user matched ${JSON.stringify(args)}. Run \`npm run db:login-as\` to list users.`);
  }

  const accessToken = jwt.sign(
    { userId: user.id, stravaId: user.stravaId, isAdmin: user.isAdmin },
    secret,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const refreshTokenRow = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: crypto.randomBytes(40).toString('hex'),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
    select: { token: true },
  });

  const origin = frontendOrigin(args.origin);
  const loginUrl = `${origin}/login?accessToken=${accessToken}&refreshToken=${refreshTokenRow.token}`;

  console.log(`\n🔑 Forged a session for ${user.firstname} ${user.lastname} (id=${user.id}, stravaId=${user.stravaId}).\n`);
  console.log('Open this in a SECOND browser / incognito window to act as them:\n');
  console.log(`   ${loginUrl}\n`);
  console.log('Or drive the API directly as this user with curl:\n');
  console.log(`   export TOKEN='${accessToken}'`);
  console.log(`   curl -H "Authorization: Bearer $TOKEN" ${(process.env.API_URL ?? 'http://localhost:3030/api').replace(/\/$/, '')}/auth/me\n`);
  console.log('Note: the access token expires in 15 min; the PWA auto-refreshes it via the refresh token, but raw curl will need a fresh token (re-run this script).\n');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
