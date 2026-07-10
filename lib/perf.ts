/**
 * Lightweight performance timer — zero external dependencies.
 *
 * Usage:
 *   const t = Perf.start();
 *   // ... work ...
 *   Perf.end('yolo_infer', t);
 *
 * Periodic dump: call Perf.startDump() once at app init.
 * Manual dump:   Perf.print() — or search logcat for "[PERF]".
 */

const MAX_SAMPLES = 500;
const _data = new Map<string, number[]>();

function push(key: string, ms: number) {
  let arr = _data.get(key);
  if (!arr) { arr = []; _data.set(key, arr); }
  if (arr.length >= MAX_SAMPLES) arr.shift();
  arr.push(ms);
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(Math.floor(sorted.length * p), sorted.length - 1);
  return sorted[i];
}

export const Perf = {
  /** Returns a start timestamp (ms). */
  start(): number {
    return performance.now();
  },

  /** Records duration from startMs to now under key. Returns duration. */
  end(key: string, startMs: number): number {
    const dur = performance.now() - startMs;
    push(key, dur);
    return dur;
  },

  /** Records an explicit duration (useful for FPS or external measurements). */
  record(key: string, durationMs: number): void {
    push(key, durationMs);
  },

  /** Returns formatted summary string. */
  summary(): string {
    const lines: string[] = ['[PERF] ===== KÖREM Performance Summary ====='];
    for (const [key, raw] of _data.entries()) {
      if (!raw.length) continue;
      const sorted = [...raw].sort((a, b) => a - b);
      const mean   = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const p50    = percentile(sorted, 0.50);
      const p95    = percentile(sorted, 0.95);
      const fps    = key.endsWith('_cycle') ? `  fps≈${(1000 / mean).toFixed(1)}` : '';
      lines.push(
        `[PERF]  ${key.padEnd(28)} n=${String(raw.length).padStart(4)}` +
        `  mean=${mean.toFixed(1).padStart(7)}ms` +
        `  p50=${p50.toFixed(1).padStart(7)}ms` +
        `  p95=${p95.toFixed(1).padStart(7)}ms${fps}`
      );
    }
    lines.push('[PERF] ==========================================');
    return lines.join('\n');
  },

  /** Prints summary to console (visible in Metro + adb logcat). */
  print(): void {
    console.log(Perf.summary());
  },

  /** Clears all recorded data. */
  reset(): void {
    _data.clear();
  },

  /**
   * Starts periodic dump every intervalMs (default 60 s).
   * Call once at app startup. Returns interval handle for cleanup.
   * Output visible in: Metro console, `adb logcat | grep PERF`.
   */
  startDump(intervalMs = 60_000): ReturnType<typeof setInterval> {
    return setInterval(() => Perf.print(), intervalMs);
  },
};
