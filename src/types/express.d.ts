// Express module augmentation
// This extends Express Request interface with custom properties
declare namespace Express {
  interface Request {
    userId?: number;
    stravaId?: number;
    isAdmin?: boolean;
    // Populated by the `verify` callback on express.json() in server.ts so
    // routes that need byte-accurate request payloads (QStash signature
    // verification) can hash the original bytes.
    rawBody?: Buffer;
  }
}
