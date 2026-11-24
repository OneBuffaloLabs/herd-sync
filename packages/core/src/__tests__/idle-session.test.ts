import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  IdleSessionController
} from "@/session/IdleSessionController";

describe("IdleSessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should default to 20 minutes and fire onIdleTimeout after inactivity", () => {
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(20 * 60 * 1000);

    const onIdleTimeout = vi.fn();
    const controller = new IdleSessionController({ onIdleTimeout });
    controller.start();

    vi.advanceTimersByTime(DEFAULT_IDLE_TIMEOUT_MS - 1);
    expect(onIdleTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdleTimeout).toHaveBeenCalledTimes(1);
  });

  it("should reset the countdown whenever recordActivity is called", () => {
    const onIdleTimeout = vi.fn();
    const controller = new IdleSessionController({
      idleTimeoutMs: 5000,
      onIdleTimeout
    });
    controller.start();

    vi.advanceTimersByTime(4000);
    expect(onIdleTimeout).not.toHaveBeenCalled();

    controller.recordActivity();
    vi.advanceTimersByTime(4000);
    expect(onIdleTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onIdleTimeout).toHaveBeenCalledTimes(1);
  });

  it("should disable the timer when idleTimeoutMs is 0 or null", () => {
    const onIdleZero = vi.fn();
    const zeroController = new IdleSessionController({
      idleTimeoutMs: 0,
      onIdleTimeout: onIdleZero
    });
    zeroController.start();
    vi.advanceTimersByTime(DEFAULT_IDLE_TIMEOUT_MS * 2);
    expect(onIdleZero).not.toHaveBeenCalled();

    const onIdleNull = vi.fn();
    const nullController = new IdleSessionController({
      idleTimeoutMs: null,
      onIdleTimeout: onIdleNull
    });
    nullController.start();
    vi.advanceTimersByTime(DEFAULT_IDLE_TIMEOUT_MS * 2);
    expect(onIdleNull).not.toHaveBeenCalled();
  });

  it("should cancel pending timeout when stop is called", () => {
    const onIdleTimeout = vi.fn();
    const controller = new IdleSessionController({
      idleTimeoutMs: 1000,
      onIdleTimeout
    });
    controller.start();

    vi.advanceTimersByTime(500);
    controller.stop();
    vi.advanceTimersByTime(2000);

    expect(onIdleTimeout).not.toHaveBeenCalled();
  });
});
