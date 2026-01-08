// Express module augmentation
// This extends Express Request interface with custom properties
declare namespace Express {
  interface Request {
    userId?: number;
    stravaId?: number;
    isAdmin?: boolean;
  }
}
