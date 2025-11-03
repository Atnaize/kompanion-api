import type { Request, Response } from 'express';
import { EventsService } from './events.service.js';
import { prisma } from '@shared/utils/index.js';

export class EventsController {
  private eventsService: EventsService;

  constructor() {
    this.eventsService = new EventsService();
  }

  /**
   * GET /api/challenges/:id/events
   * Get events for a specific challenge with ETag support
   */
  getChallengeEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { since } = req.query;

      // Verify user has access to this challenge
      const participant = await this.verifyAccess(id, userId);

      if (!participant) {
        res.status(403).json({ success: false, error: 'You do not have access to this challenge' });
        return;
      }

      // Parse since timestamp
      const sinceDate = since ? new Date(since as string) : undefined;

      if (since && (!sinceDate || isNaN(sinceDate.getTime()))) {
        res
          .status(400)
          .json({ success: false, error: 'Invalid since parameter. Use ISO 8601 format.' });
        return;
      }

      const { events, etag } = await this.eventsService.getChallengeEvents(id, sinceDate);

      // Check If-None-Match header for conditional request
      const clientETag = req.headers['if-none-match'];

      if (clientETag === etag) {
        // No new events, return 304 Not Modified
        res.status(304).end();
        return;
      }

      // Return events with ETag header
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache'); // Allow caching but require validation
      res.status(200).json({
        success: true,
        data: {
          events,
          latestTimestamp: events.length > 0 ? events[events.length - 1].createdAt : null,
        },
      });
    } catch (error) {
      console.error('[Events Controller] Get challenge events error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges/events
   * Get events for all challenges the user is participating in
   */
  getUserChallengeEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { since } = req.query;

      // Parse since timestamp
      const sinceDate = since ? new Date(since as string) : undefined;

      if (since && (!sinceDate || isNaN(sinceDate.getTime()))) {
        res
          .status(400)
          .json({ success: false, error: 'Invalid since parameter. Use ISO 8601 format.' });
        return;
      }

      const { events, etag } = await this.eventsService.getUserChallengeEvents(userId, sinceDate);

      // Check If-None-Match header for conditional request
      const clientETag = req.headers['if-none-match'];

      if (clientETag === etag) {
        // No new events, return 304 Not Modified
        res.status(304).end();
        return;
      }

      // Return events with ETag header
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({
        success: true,
        data: {
          events,
          latestTimestamp: events.length > 0 ? events[events.length - 1].createdAt : null,
        },
      });
    } catch (error) {
      console.error('[Events Controller] Get user events error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * Verify user has access to a challenge
   */
  private async verifyAccess(challengeId: string, userId: number): Promise<boolean> {
    const participant = await prisma.challengeParticipant.findUnique({
      where: {
        challengeId_userId: {
          challengeId,
          userId,
        },
      },
    });

    return participant !== null;
  }
}
