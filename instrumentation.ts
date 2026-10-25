/**
 * Next.js instrumentation hook — runs once when the Node.js server starts.
 *
 * Registers the idle-conversation memory extraction loop:
 *   - 30-second delay after boot (let the server warm up)
 *   - then fires every 2 minutes
 *
 * This file is auto-detected by Next.js 15+ (no experimental flag needed).
 * It only runs on the Node.js runtime, never in the Edge runtime.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Lazy-import so the module graph stays clean for edge/browser bundles
  const { runIdleExtraction } = await import('@/lib/memory-scheduler');

  const INITIAL_DELAY_MS = 30_000;   // 30 s — let the server settle
  const INTERVAL_MS      = 2 * 60_000; // 2 minutes

  setTimeout(() => {
    // First run
    runIdleExtraction().catch((err) =>
      console.error('[instrumentation] idle extraction error:', err)
    );

    // Recurring run every 2 minutes
    setInterval(() => {
      runIdleExtraction().catch((err) =>
        console.error('[instrumentation] idle extraction error:', err)
      );
    }, INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log('[instrumentation] memory extraction scheduler registered');

  // ── Application email monitor — runs every 6 hours ────────────────────────
  const EMAIL_MONITOR_INTERVAL_MS = 6 * 60 * 60_000; // 6 hours
  const EMAIL_MONITOR_INITIAL_MS  = 60_000;           // 1 min after boot

  setTimeout(() => {
    const runMonitor = async () => {
      try {
        const { runEmailMonitor } = await import('@/lib/application-email-monitor');
        const result = await runEmailMonitor('berkeley', 6);
        if (result.updated > 0) {
          console.log(`[instrumentation] email monitor: ${result.updated} card(s) updated`, result.events);
        }
      } catch (err) {
        console.error('[instrumentation] email monitor error:', err);
      }
    };

    runMonitor();
    setInterval(runMonitor, EMAIL_MONITOR_INTERVAL_MS);
  }, EMAIL_MONITOR_INITIAL_MS);

  console.log('[instrumentation] application email monitor scheduler registered');
}
