/**
 * lib/resume/dump-candidate-pool.ts
 *
 * Dev/diagnostic runner: builds the deterministic candidate pool and prints it
 * as pretty JSON to stdout. Run with:
 *
 *   npx tsx lib/resume/dump-candidate-pool.ts
 *
 * Not imported by the app — a manual inspection tool for Phase 3a.
 */

import { buildCandidatePool } from '@/lib/resume/candidate-pool';

const pool = buildCandidatePool();

const withMetrics = pool.claims.filter((c) => c.metrics.length > 0).length;
console.error(
  `[dump-candidate-pool] ${pool.entities.length} entities, ${pool.claims.length} claims ` +
  `(${withMetrics} carry metric tokens).`,
);

console.log(JSON.stringify(pool, null, 2));
