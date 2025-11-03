# Strava Webhooks Setup Guide

This guide explains how to set up Strava webhooks for real-time activity updates in Kompanion.

## What are Strava Webhooks?

Strava webhooks notify your API when activities are created, updated, or deleted. This allows challenges to update automatically when users complete activities, without requiring manual syncing.

## Prerequisites

1. Your API must be deployed and accessible via HTTPS
2. You need your Strava application's Client ID and Client Secret
3. You need to set the `STRAVA_WEBHOOK_VERIFY_TOKEN` environment variable

## Setup Steps

### 1. Configure Environment Variables

Add to your `.env` file:

```bash
STRAVA_WEBHOOK_VERIFY_TOKEN=your_random_secret_string_here
```

Generate a random token with:
```bash
openssl rand -hex 32
```

### 2. Subscribe to Webhooks

Use this curl command to subscribe (replace values with your own):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://your-api.vercel.app/api/webhooks/strava \
  -F verify_token=your_random_secret_string_here
```

**Important:**
- `callback_url` must be HTTPS (localhost won't work for production)
- `verify_token` must match the one in your `.env` file
- Strava will send a GET request to validate your endpoint before subscribing

Expected response:
```json
{
  "id": 12345,
  "resource_state": 2,
  "application_id": 67890,
  "callback_url": "https://your-api.vercel.app/api/webhooks/strava",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### 3. View Your Subscription

Check your current subscription:

```bash
curl -G https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET
```

### 4. Delete Subscription (if needed)

To remove a subscription:

```bash
curl -X DELETE https://www.strava.com/api/v3/push_subscriptions/SUBSCRIPTION_ID \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET
```

## How It Works

### Subscription Validation (GET request)

When you subscribe, Strava sends a GET request to verify your endpoint:

```
GET /api/webhooks/strava?hub.verify_token=YOUR_TOKEN&hub.challenge=RANDOM_STRING&hub.mode=subscribe
```

Your API responds with:
```json
{
  "hub.challenge": "RANDOM_STRING"
}
```

### Event Notifications (POST requests)

When a user's activity is created/updated/deleted, Strava sends:

```json
{
  "object_type": "activity",
  "object_id": 12345678,
  "aspect_type": "create",
  "owner_id": 67890,
  "subscription_id": 12345,
  "event_time": 1234567890
}
```

Your API:
1. Responds with `200 OK` within 2 seconds
2. Fetches full activity details from Strava API
3. Updates user stats
4. Updates active challenges
5. Creates events for frontend polling

## Testing Webhooks Locally

For local development, use [ngrok](https://ngrok.com/) to expose your local server:

```bash
# Start your API locally
npm run dev

# In another terminal, start ngrok
ngrok http 3000

# Use the ngrok HTTPS URL for callback_url
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://YOUR_NGROK_URL.ngrok.io/api/webhooks/strava \
  -F verify_token=your_token
```

## Troubleshooting

### Validation fails

- **Error: Invalid verify token**
  - Check `STRAVA_WEBHOOK_VERIFY_TOKEN` matches in `.env` and subscription request

- **Error: No response from endpoint**
  - Verify your API is running and accessible
  - Check HTTPS is enabled (required for production)

### Events not being received

- **Check subscription status:**
  ```bash
  curl -G https://www.strava.com/api/v3/push_subscriptions \
    -d client_id=YOUR_CLIENT_ID \
    -d client_secret=YOUR_CLIENT_SECRET
  ```

- **Check API logs:**
  - Vercel: `vercel logs`
  - Local: Check console output

- **Verify callback URL:**
  - Must be publicly accessible
  - Must respond within 2 seconds
  - Must return 200 status code

### Events not updating challenges

Check that:
1. User has an active challenge
2. Activity date is within challenge start/end dates
3. User has accepted the challenge invitation
4. Activity type matches challenge requirements (if specified)

## Event Flow

```
User completes run
  ↓
Strava detects new activity
  ↓
Strava sends webhook to /api/webhooks/strava
  ↓
API responds 200 OK (< 2 seconds)
  ↓
API fetches full activity from Strava API
  ↓
API updates user stats
  ↓
API finds active challenges for user
  ↓
API adds activity to challenges
  ↓
API updates participant progress
  ↓
API creates event for frontend polling
  ↓
Frontend shows notification: "🔥 You just added 10km!"
```

## Rate Limits

- Strava will retry webhook delivery up to 3 times if you don't respond with 200
- Your endpoint must respond within 2 seconds
- Process heavy work asynchronously (already implemented with `setImmediate`)

## Security

- Always verify the `verify_token` on GET requests
- Consider adding signature verification for POST requests (optional)
- Keep your `STRAVA_CLIENT_SECRET` secure
- Never commit `.env` files to git

## Production Checklist

- [ ] `STRAVA_WEBHOOK_VERIFY_TOKEN` set in production environment
- [ ] API deployed and accessible via HTTPS
- [ ] Webhook subscription created with production callback URL
- [ ] Test activity creation triggers webhook
- [ ] Verify challenges update automatically
- [ ] Monitor logs for webhook errors

## Resources

- [Strava Webhook Documentation](https://developers.strava.com/docs/webhooks/)
- [Strava API Reference](https://developers.strava.com/docs/reference/)
- [Webhook Event Types](https://developers.strava.com/docs/webhooks/#event-data)
