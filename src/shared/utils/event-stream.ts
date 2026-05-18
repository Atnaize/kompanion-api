import type { Request, Response } from 'express';

// Thin SSE helper. Sets headers once, then exposes `send(event)` /
// `close()`. Caller owns the event shape (use a discriminated union).
//
// Keeping it as a class so the underlying Response stays encapsulated and
// callers don't accidentally `res.json(...)` mid-stream.
export class EventStream<TEvent> {
  private closed = false;

  constructor(
    _req: Request,
    private readonly res: Response
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
    res.flushHeaders();
  }

  send(event: TEvent): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}
