import type { Request, Response } from 'express';
import { ChallengeService } from './challenge.service.js';
import { z } from 'zod';
import type { ChallengeType, CompetitiveGoal } from '@shared/types/index.js';

const createChallengeSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['collaborative', 'competitive']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  targets: z.object({
    distance: z.number().positive().optional(),
    elevation: z.number().positive().optional(),
    activityType: z.string().optional(),
  }),
  competitiveGoal: z.enum(['most', 'least', 'exact']).optional(),
  invitedUserIds: z.array(z.number()).optional(),
});

const updateChallengeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  targets: z
    .object({
      distance: z.number().positive().optional(),
      elevation: z.number().positive().optional(),
      activityType: z.string().optional(),
    })
    .optional(),
});

export class ChallengeController {
  private challengeService: ChallengeService;

  constructor() {
    this.challengeService = new ChallengeService();
  }

  /**
   * POST /api/challenges
   * Create a new challenge
   */
  createChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const validatedData = createChallengeSchema.parse(req.body);

      // Validate at least one target is set
      if (!validatedData.targets.distance && !validatedData.targets.elevation) {
        res.status(400).json({ error: 'At least one target (distance or elevation) must be set' });
        return;
      }

      const challenge = await this.challengeService.createChallenge({
        creatorId: userId,
        name: validatedData.name,
        description: validatedData.description,
        type: validatedData.type as ChallengeType,
        startDate: new Date(validatedData.startDate),
        endDate: new Date(validatedData.endDate),
        targets: validatedData.targets,
        competitiveGoal: validatedData.competitiveGoal as CompetitiveGoal | undefined,
        invitedUserIds: validatedData.invitedUserIds,
      });

      res.status(201).json({ success: true, data: challenge });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
        return;
      }

      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Create error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges
   * Get all challenges for authenticated user
   */
  getChallenges = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { status, type } = req.query;

      const challenges = await this.challengeService.getChallengesForUser(userId, {
        status: status as string | undefined,
        type: type as ChallengeType | undefined,
      });

      res.status(200).json({ success: true, data: challenges });
    } catch (error) {
      console.error('[Challenge Controller] Get challenges error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges/:id
   * Get a specific challenge
   */
  getChallengeById = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const challenge = await this.challengeService.getChallengeById(id, userId);

      if (!challenge) {
        res.status(404).json({ success: false, error: 'Challenge not found' });
        return;
      }

      res.status(200).json({ success: true, data: challenge });
    } catch (error) {
      if (error instanceof Error && error.message.includes('do not have access')) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Get challenge error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges/:id/progress
   * Get challenge progress
   */
  getChallengeProgress = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      // Verify access first
      const challenge = await this.challengeService.getChallengeById(id, userId);

      if (!challenge) {
        res.status(404).json({ success: false, error: 'Challenge not found' });
        return;
      }

      const progress = await this.challengeService.getChallengeProgress(id);

      res.status(200).json({ success: true, data: progress });
    } catch (error) {
      if (error instanceof Error && error.message.includes('do not have access')) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Get progress error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * PATCH /api/challenges/:id
   * Update a challenge
   */
  updateChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const validatedData = updateChallengeSchema.parse(req.body);

      const challenge = await this.challengeService.updateChallenge(id, userId, {
        name: validatedData.name,
        description: validatedData.description,
        startDate: validatedData.startDate ? new Date(validatedData.startDate) : undefined,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : undefined,
        targets: validatedData.targets,
      });

      res.status(200).json({ success: true, data: challenge });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
        return;
      }

      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Update error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/challenges/:id/cancel
   * Cancel a challenge
   */
  cancelChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const challenge = await this.challengeService.cancelChallenge(id, userId);

      res.status(200).json({ success: true, data: challenge });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Cancel error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/challenges/:id
   * Delete an upcoming challenge
   */
  deleteChallenge = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      await this.challengeService.deleteChallenge(id, userId);

      res.status(200).json({ success: true, message: 'Challenge deleted' });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Delete error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * GET /api/challenges/unseen-completed
   * Get completed challenges the user hasn't seen the summary for
   */
  getUnseenCompleted = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Ensure expired challenges are completed first
      await this.challengeService.completeExpiredChallenges();

      const challenges = await this.challengeService.getUnseenCompletedChallenges(userId);

      res.status(200).json({ success: true, data: challenges });
    } catch (error) {
      console.error('[Challenge Controller] Get unseen completed error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };

  /**
   * POST /api/challenges/:id/summary-seen
   * Mark challenge completion summary as seen
   */
  markSummarySeen = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      await this.challengeService.markChallengeSummarySeen(id, userId);

      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }

      console.error('[Challenge Controller] Mark summary seen error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}
