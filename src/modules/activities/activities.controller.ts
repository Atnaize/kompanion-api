import type { Request, Response, NextFunction } from 'express';
import { ActivitiesService } from './activities.service.js';
import { HttpStatus } from '@shared/types/index.js';
import { validateNumericId, EventStream } from '@shared/utils/index.js';
import { logger } from '@shared/logger/index.js';

type SyncEvent =
  | { type: 'fetching'; current?: number; total?: number; message?: string }
  | { type: 'saving'; current?: number; total?: number; message?: string }
  | { type: 'processing'; current?: number; total?: number; message?: string }
  | {
      type: 'complete';
      total: number;
      message: string;
      challengesSynced?: number;
      challengeActivitiesAdded?: number;
    }
  | { type: 'error'; message: string };

const parseActivityId = (raw: unknown, res: Response): number | null => {
  const validation = validateNumericId(raw);
  if (!validation.isValid) {
    res
      .status(HttpStatus.BAD_REQUEST)
      .json({ success: false, error: validation.error || 'Invalid activity ID' });
    return null;
  }
  return parseInt(String(raw), 10);
};

const send404 = (res: Response, error = 'Activity not found'): void => {
  res.status(HttpStatus.NOT_FOUND).json({ success: false, error });
};

export class ActivitiesController {
  private activitiesService = new ActivitiesService();

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activities = await this.activitiesService.getUserActivities(req.user!.id);
      res.json({ success: true, data: activities });
    } catch (error) {
      next(error);
    }
  };

  sync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.activitiesService.syncActivities(req.user!);
      res.json({
        success: true,
        data: result,
        message: `Synced ${result.synced} new activities`,
      });
    } catch (error) {
      next(error);
    }
  };

  syncWithProgress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user!;
    logger.info({ reqId: req.id, userId: user.id }, '[Sync] start');

    const stream = new EventStream<SyncEvent>(req, res);

    try {
      const result = await this.activitiesService.syncActivitiesWithProgress(user, (e) =>
        stream.send(e as SyncEvent)
      );

      logger.info({ reqId: req.id, userId: user.id, synced: result.synced }, '[Sync] complete');

      stream.send({
        type: 'complete',
        total: result.synced,
        message: `Synced ${result.synced} activities`,
        challengesSynced: result.challengesSynced,
        challengeActivitiesAdded: result.challengeActivitiesAdded,
      });
      stream.close();
    } catch (error) {
      logger.error({ reqId: req.id, userId: user.id, err: error }, '[Sync] failed');
      stream.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Sync failed',
      });
      stream.close();
      // Don't forward to error middleware — we've already responded via SSE.
      if (!res.headersSent) next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const activity = await this.activitiesService.getDetailedActivityById(activityId, req.user!);

      if (!activity) {
        send404(res);
        return;
      }

      res.json({ success: true, data: activity });
    } catch (error) {
      next(error);
    }
  };

  getStreams = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const streams = await this.activitiesService.getActivityStreams(activityId, req.user!);
      if (streams === null) {
        send404(res);
        return;
      }
      res.json({ success: true, data: streams });
    } catch (error) {
      next(error);
    }
  };

  getKudoers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const kudoers = await this.activitiesService.getActivityKudoers(activityId, req.user!);
      if (kudoers === null) {
        send404(res);
        return;
      }
      res.json({ success: true, data: kudoers });
    } catch (error) {
      next(error);
    }
  };

  getComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const comments = await this.activitiesService.getActivityComments(activityId, req.user!);
      if (comments === null) {
        send404(res);
        return;
      }
      res.json({ success: true, data: comments });
    } catch (error) {
      next(error);
    }
  };

  getPhotos = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const photos = await this.activitiesService.getActivityPhotos(activityId, req.user!);
      if (photos === null) {
        send404(res);
        return;
      }
      res.json({ success: true, data: photos });
    } catch (error) {
      next(error);
    }
  };

  getLaps = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activityId = parseActivityId(req.params.id, res);
      if (activityId === null) return;

      const laps = await this.activitiesService.getActivityLaps(activityId, req.user!);
      if (laps === null) {
        send404(res);
        return;
      }
      res.json({ success: true, data: laps });
    } catch (error) {
      next(error);
    }
  };

  // POST /api/activities/test/delete — deletes activities and recomputes
  // dependent rows (stats, challenges, achievements). Wide blast radius:
  // intended only for test users / E2E setup.
  deleteActivitiesForTest = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { activityIds } = req.body as { activityIds?: number[] };

      if (!activityIds || !Array.isArray(activityIds) || activityIds.length === 0) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ success: false, error: 'activityIds array is required' });
        return;
      }

      const result = await this.activitiesService.deleteActivitiesAndRecalculate(
        req.user!.id,
        activityIds
      );

      res.json({
        success: true,
        data: result,
        message: `Deleted ${result.deleted} activities, removed ${result.challengeActivitiesRemoved} challenge activities, updated ${result.challengesUpdated} challenge(s)`,
      });
    } catch (error) {
      next(error);
    }
  };
}
