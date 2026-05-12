import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
import './bootstrap.js';

let cached: ReturnType<OpenApiGeneratorV31['generateDocument']> | null = null;

export function getOpenApiDocument() {
  if (cached) {
    return cached;
  }

  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT access token issued by `/api/auth/callback` or `/api/auth/refresh`.',
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);

  cached = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Kompanion API',
      version: '1.0.0',
      description:
        'Backend API for **Kompanion** — a Strava gamification app. Activities sync from Strava, surface stats, achievements, challenges, social feed, and personal records.',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local dev' },
      { url: 'https://api.kompanion.app', description: 'Production' },
    ],
    tags: [
      { name: 'Auth', description: 'Strava OAuth login, JWT tokens, account deletion' },
      { name: 'Activities', description: 'Strava activities — list, sync, details, streams' },
      { name: 'Stats', description: 'Aggregated stats, progress, period comparisons, heatmap' },
      { name: 'Achievements', description: 'Earned achievements and redemption' },
      { name: 'Challenges', description: 'Group challenges, invitations, progress, events' },
      { name: 'Friends', description: 'Friend graph — requests, search, list, unfriend' },
      { name: 'Users', description: 'Public user profiles' },
      { name: 'Feed', description: 'Social activity feed' },
      { name: 'Notifications', description: 'Web push subscriptions and preferences' },
      { name: 'Personal Records', description: 'Computed PRs per distance and activity type' },
      { name: 'Webhooks', description: 'Strava webhook receiver and admin diagnostics' },
      { name: 'Admin: Quota', description: 'Admin endpoints for Strava API quota management' },
      { name: 'System', description: 'Health, debug, OpenAPI spec' },
    ],
  });

  return cached;
}
