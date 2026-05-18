// Express module augmentation
// This extends Express Request interface with custom properties
import type { User } from '../shared/types/index.js';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      stravaId?: number;
      isAdmin?: boolean;
      // Populated by the requireUser middleware (src/shared/middleware/
      // require-user.middleware.ts) after JWT verification. Present on every
      // request that flows through requireUser; assume undefined otherwise.
      user?: User;
      // Populated by the `verify` callback on express.json() in server.ts so
      // routes that need byte-accurate request payloads (QStash signature
      // verification) can hash the original bytes.
      rawBody?: Buffer;
    }
  }
}
