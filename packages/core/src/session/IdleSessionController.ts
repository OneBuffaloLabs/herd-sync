/**
 * Default inactivity timeout before an active sync session disconnects (20 minutes).
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export interface IdleSessionControllerOptions {
  idleTimeoutMs?: number | null;
  onIdleTimeout: () => void | Promise<void>;
}

/**
 * Tracks sync/peer activity and triggers an idle disconnect callback
 * after `idleTimeoutMs` of inactivity.
 */
export class IdleSessionController {
  private timeoutMs: number | null;
  private onIdleTimeout: () => void | Promise<void>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(options: IdleSessionControllerOptions) {
    this.timeoutMs =
      options.idleTimeoutMs === undefined ? DEFAULT_IDLE_TIMEOUT_MS : options.idleTimeoutMs;
    this.onIdleTimeout = options.onIdleTimeout;
  }

  public isEnabled(): boolean {
    return this.timeoutMs !== null && this.timeoutMs > 0;
  }

  public start(): void {
    this.active = true;
    this.scheduleTimer();
  }

  public recordActivity(): void {
    if (!this.active) {
      this.active = true;
    }
    this.scheduleTimer();
  }

  public stop(): void {
    this.active = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public updateTimeout(idleTimeoutMs?: number | null): void {
    this.timeoutMs = idleTimeoutMs === undefined ? DEFAULT_IDLE_TIMEOUT_MS : idleTimeoutMs;
    if (this.active) {
      this.scheduleTimer();
    }
  }

  private scheduleTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.active || !this.isEnabled() || this.timeoutMs === null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.active = false;
      void this.onIdleTimeout();
    }, this.timeoutMs);
  }
}
