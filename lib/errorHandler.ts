/**
 * Shared error-handling utilities.
 *
 * withTimeout   — races a promise against a deadline.
 * withRetry     — retries a factory function with exponential back-off.
 * shouldAnnounceError — rate-limits TTS error announcements to once per 30 s
 *                       per error class, so repeated failures are not deafening.
 */

/** Reject with Error('TIMEOUT') if the promise doesn't settle within ms. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms),
    ),
  ]);
}

/**
 * Call fn(), retry up to maxAttempts additional times on failure.
 * Waits baseDelayMs × 2^attempt between attempts (exponential back-off).
 *
 * @example
 *   const result = await withRetry(() => fetch(url), 1, 1_000);
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 1,
  baseDelayMs = 1_000,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      attempt++;
    }
  }
}

const _lastAnnounce = new Map<string, number>();
const ANNOUNCE_INTERVAL_MS = 30_000;

/**
 * Returns true (and records the time) if no announcement has been made
 * for this error class in the past 30 seconds. Use before calling speak()
 * to avoid repeating the same error phrase on every failed poll cycle.
 */
export function shouldAnnounceError(cls: string): boolean {
  const now = Date.now();
  const last = _lastAnnounce.get(cls) ?? 0;
  if (now - last > ANNOUNCE_INTERVAL_MS) {
    _lastAnnounce.set(cls, now);
    return true;
  }
  return false;
}
