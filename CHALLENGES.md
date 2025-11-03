# Challenge System Implementation Guide

This document explains the challenge system implemented for Kompanion, allowing users to create collaborative and competitive challenges with their Strava friends.

## Overview

The challenge system enables users to:
- Create collaborative challenges with shared goals
- Invite Strava friends to challenges
- Track real-time progress via webhooks
- Poll for challenge events efficiently with ETag caching
- Automatically complete/fail challenges when deadlines are reached

## Architecture

### Database Schema

Four new tables were added ([prisma/schema.prisma](prisma/schema.prisma#L229-L324)):

1. **Challenge** - Main challenge data
   - Support for both `collaborative` and `competitive` types
   - Flexible JSON targets (distance, elevation, activityType)
   - Status tracking (draft, active, completed, failed, cancelled)

2. **ChallengeParticipant** - Users in a challenge
   - Invitation status (invited, accepted, declined, left)
   - Cached progress metrics (distance, elevation, activity count)
   - Optimized for quick leaderboard queries

3. **ChallengeActivity** - Activities linked to challenges
   - Denormalized activity data for performance
   - Prevents duplicate activity submissions
   - Indexed for efficient time-range queries

4. **ChallengeEvent** - Event log for frontend polling
   - Supports efficient polling with timestamp queries
   - Auto-cleanup of old events (30 days)
   - Indexed for optimal polling performance

### API Endpoints

#### Challenge CRUD
- `POST /api/challenges` - Create new challenge
- `GET /api/challenges` - List user's challenges (with filters)
- `GET /api/challenges/:id` - Get challenge details
- `PATCH /api/challenges/:id` - Update challenge
- `DELETE /api/challenges/:id` - Delete draft challenge
- `POST /api/challenges/:id/start` - Start challenge
- `POST /api/challenges/:id/cancel` - Cancel challenge
- `GET /api/challenges/:id/progress` - Get progress summary

#### Invitations
- `GET /api/challenges/invitations` - Get pending invitations
- `POST /api/challenges/:id/invite` - Invite users
- `POST /api/challenges/:id/accept` - Accept invitation
- `POST /api/challenges/:id/decline` - Decline invitation
- `POST /api/challenges/:id/leave` - Leave challenge

#### Events (Polling)
- `GET /api/challenges/events` - Poll all user's challenge events
- `GET /api/challenges/:id/events` - Poll specific challenge events
- Supports `?since=<ISO timestamp>` parameter
- Returns ETag header for efficient caching
- Returns 304 Not Modified when no new events

#### Friends
- `GET /api/friends` - Get Kompanion friends from Strava
- `GET /api/friends/invitees?challengeId=<id>` - Get potential invitees
- `GET /api/friends/search?q=<query>` - Search users by name

#### Cron Jobs
- `POST /api/cron/check-challenges` - Check and update expired challenges
- `POST /api/cron/cleanup` - Clean up old events and tokens

## Real-time Updates

### Webhook Integration

When a user completes an activity on Strava:

1. Strava sends webhook to `/api/webhooks/strava`
2. Webhook service responds with 200 OK (< 2 seconds)
3. Activity is processed asynchronously:
   - Fetched from Strava API
   - Saved to database
   - User stats updated
   - Active challenges found
   - Activity added to challenges
   - Participant progress updated
   - Event created for frontend

### Frontend Polling

Frontend polls for events every 30-60 seconds:

```typescript
// Poll for all challenge events
GET /api/challenges/events?since=2024-10-31T12:00:00Z
If-None-Match: "abc123def456"

// Response (if new events)
200 OK
ETag: "xyz789abc123"
{
  "events": [...],
  "latestTimestamp": "2024-10-31T12:05:00Z"
}

// Response (if no new events)
304 Not Modified
```

Benefits:
- Feels real-time (30-60s latency)
- Works on Vercel serverless
- Minimal bandwidth usage
- No WebSocket complexity

## Cron Jobs

Configured in [vercel.json](vercel.json#L11-L20):

1. **Check Challenges** - Runs every hour
   - Finds active challenges past their end date
   - Evaluates if goals were met
   - Updates status to `completed` or `failed`
   - Creates completion/failure events

2. **Cleanup** - Runs daily at midnight
   - Removes events older than 30 days (except milestones)
   - Removes expired refresh tokens

## Challenge Types

### Collaborative
- All participants work towards a shared goal
- Example: "Run 150km together by Nov 30"
- Success: Combined distance/elevation meets target
- Creates team spirit and cooperation

### Competitive (v2 - planned)
- Participants compete for highest/lowest/exact values
- `competitiveGoal` field determines winner:
  - `most` - Highest total wins
  - `least` - Lowest total wins
  - `exact` - Closest to target wins
- Leaderboard and ranking features

## Code Structure

```
kompanion-api/src/modules/
├── challenges/
│   ├── challenge.service.ts       # CRUD operations
│   ├── challenge.controller.ts    # HTTP handlers
│   ├── invitation.service.ts      # Invitation logic
│   ├── invitation.controller.ts   # Invitation HTTP handlers
│   ├── events.service.ts          # Event polling logic
│   ├── events.controller.ts       # Event HTTP handlers
│   ├── challenge.routes.ts        # Route definitions
│   └── index.ts                   # Exports
│
├── friends/
│   ├── friends.service.ts         # Strava friends API
│   ├── friends.controller.ts      # HTTP handlers
│   ├── friends.routes.ts          # Route definitions
│   └── index.ts                   # Exports
│
├── cron/
│   ├── cron.service.ts            # Deadline checking & cleanup
│   ├── cron.controller.ts         # HTTP handlers
│   ├── cron.routes.ts             # Route definitions
│   └── index.ts                   # Exports
│
└── webhooks/
    └── strava-webhook.service.ts  # Already implemented
```

## Environment Variables

Add to your `.env` file:

```bash
# Already configured
STRAVA_WEBHOOK_VERIFY_TOKEN=your_random_token

# New for cron auth (optional in development)
CRON_SECRET=your_cron_secret_for_vercel_cron_jobs
```

## Example Usage

### Creating a Challenge

```bash
POST /api/challenges
Authorization: Bearer <token>

{
  "name": "November Running Challenge",
  "description": "Let's run 150km together!",
  "type": "collaborative",
  "startDate": "2024-11-01T00:00:00Z",
  "endDate": "2024-11-30T23:59:59Z",
  "targets": {
    "distance": 150000,  // meters
    "elevation": 5000,   // meters (optional)
    "activityType": "Run" // optional
  },
  "invitedUserIds": [2, 3, 4]
}
```

### Accepting an Invitation

```bash
POST /api/challenges/abc123/accept
Authorization: Bearer <token>
```

### Polling for Events

```bash
GET /api/challenges/events?since=2024-10-31T12:00:00Z
Authorization: Bearer <token>
If-None-Match: "abc123def456"
```

### Getting Friends to Invite

```bash
GET /api/friends/invitees?challengeId=abc123
Authorization: Bearer <token>

# Returns friends who are Kompanion users and not in this challenge
```

## Performance Considerations

### Database Optimizations
- Cached progress in `ChallengeParticipant` (no expensive aggregations)
- Composite indexes for efficient queries
- Denormalized activity data to reduce joins

### API Optimizations
- ETag caching for event polling
- Pagination ready (not yet implemented)
- Efficient timestamp-based queries
- Background processing for webhooks

### Vercel Free Tier
Current implementation is optimized for free tier:
- 2 cron jobs (well within limits)
- Polling instead of WebSockets
- Efficient database queries
- Event cleanup to reduce storage

Estimated costs at 100 active users:
- Database: <1GB storage
- API calls: ~50k/month
- Function duration: <10GB-hours
- **Well within free tier limits**

## Testing

### Local Testing

```bash
# Start the API
npm run dev

# In another terminal, test endpoints
curl -X POST http://localhost:3000/api/challenges \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @challenge.json
```

### Testing Cron Jobs Locally

```bash
# Manually trigger cron
curl -X POST http://localhost:3000/api/cron/check-challenges \
  -H "Authorization: Bearer your_cron_secret"

curl -X POST http://localhost:3000/api/cron/cleanup \
  -H "Authorization: Bearer your_cron_secret"
```

### Production Testing

After deploying to Vercel:

1. Create a challenge via API
2. Invite friends
3. Complete an activity on Strava
4. Verify webhook triggers update
5. Poll for events
6. Wait for challenge deadline
7. Verify cron completes/fails challenge

## Next Steps

### Frontend Implementation (Next Phase)
1. Challenge creation UI
2. Challenge list/detail views
3. Invitation management
4. Progress visualization
5. Real-time event polling
6. Notifications

### Future Enhancements (v2+)
1. Competitive challenge implementation
2. Challenge templates
3. Recurring challenges
4. Activity type filtering
5. Custom milestones
6. Achievement rewards
7. Social sharing

## Troubleshooting

### Build Errors
- Ensure all TypeScript errors are fixed
- Check imports use correct path aliases
- Verify Prisma client is generated

### Webhook Issues
- Verify `STRAVA_WEBHOOK_VERIFY_TOKEN` is set
- Check webhook subscription status
- Monitor API logs for webhook events

### Cron Not Running
- Verify Vercel cron is configured
- Check `CRON_SECRET` is set in Vercel
- Monitor Vercel logs

### Events Not Updating
- Check webhook is processing activities
- Verify events are being created
- Ensure frontend is polling correctly
- Check ETag logic

## Resources

- [Strava Webhooks Documentation](https://developers.strava.com/docs/webhooks/)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [WEBHOOKS.md](WEBHOOKS.md) - Webhook setup guide
