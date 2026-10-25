/**
 * lib/resume/diversity.ts — B-27 standing post-SELECT diversity pass.
 *
 * Runs AFTER SELECT, BEFORE REPHRASE, on every target. Among SELECT's chosen claims
 * it detects SAME-ENTITY redundant pairs — two grounded claims covering substantially
 * the same accomplishment (e.g. Microsoft "Built and shipped an orchestrator layer" vs
 * "Architected the multi-agent orchestration roadmap"). Selection-level ONLY: it drops
 * the lower-SELECT-ranked claim of a redundant pair and RESELECTS the next grounded
 * claim for that entity that is not redundant with anything kept. It NEVER merges or
 * rewrites claim text (merging two grounded claims would fabricate a composite).
 *
 * Detector: a Claude judgment per same-entity pair ("do these two cover substantially
 * the same accomplishment?"). Embeddings were the original plan but no embedding
 * provider is configured (OPENAI_API_KEY empty); the model judge is the robust
 * fallback the spec anticipated, and it catches TOPICAL redundancy embeddings can miss.
 *
 * Loop ≤3 passes; stop when no redundant pair remains or the diverse pool is exhausted
 * (then the entity renders fewer bullets — never pad, never merge).
 */
import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { structuredCreate } from '@/lib/resume/structured';
import { isSelectableClaim } from '@/lib/resume/bullet-hygiene';
import type { CandidatePool, Claim } from '@/lib/resume/candidate-pool';

export interface DiversityVerdict {
  entity: string;
  idA: string; textA: string;
  idB: string; textB: string;
  redundant: boolean;
  reason: string;
  pass: number;
}
export interface DiversityDecision {
  entity: string;
  dropped: string; droppedText: string;
  reason: string;
  reselected: string | null; reselectedText: string | null;
  pass: number;
}
export interface DiversityReport {
  orderedIds: string[];        // post-diversity selection (feeds REPHRASE + assembly)
  verdicts: DiversityVerdict[]; // every same-entity pair judged, all passes
  decisions: DiversityDecision[]; // drop → reselect chain
  passes: number;
}

const JUDGE_TOOL: Anthropic.Tool = {
  name: 'judge_redundancy',
  description: 'Return a redundancy verdict for each numbered pair of same-entity résumé bullets.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'the PAIR number being judged' },
            redundant: { type: 'boolean', description: 'true iff the two bullets cover substantially the SAME accomplishment' },
            reason: { type: 'string', description: 'one SHORT clause (≤12 words) justifying the verdict' },
          },
          required: ['index', 'redundant', 'reason'],
        },
      },
    },
    required: ['verdicts'],
  },
};

export interface PairIn { idA: string; textA: string; idB: string; textB: string; entity: string; }

// Verdict keyed by pair INDEX (not the long claim ids) to keep the model output small.
// Exported so a post-render G3 check can re-judge the FINAL rendered same-entity pairs
// with the identical detector.
export async function judgePairs(pairs: PairIn[]): Promise<Map<number, { redundant: boolean; reason: string }>> {
  const m = new Map<number, { redundant: boolean; reason: string }>();
  if (!pairs.length) return m;
  const listing = pairs
    .map((p, i) => `PAIR ${i} — entity "${p.entity}"\n  A: ${p.textA}\n  B: ${p.textB}`)
    .join('\n\n');
  const prompt =
    `You are de-duplicating a one-page résumé. Each PAIR below is two bullets from the SAME role/project. ` +
    `Decide whether the two cover SUBSTANTIALLY THE SAME accomplishment — the same project, feature, system, ` +
    `or outcome described twice — so that showing BOTH is redundant.\n` +
    `- Mark redundant TRUE only when they are the same thing said two ways (e.g. "built the orchestrator layer" ` +
    `and "architected the orchestration roadmap" — both the multi-agent orchestration work).\n` +
    `- Mark redundant FALSE when they are DIFFERENT facets of one project (e.g. "built the policy gateway" vs ` +
    `"built the audit log"; "designed the UI/UX" vs "led the rollout") — those are distinct accomplishments.\n` +
    `Return one verdict per pair: its index, redundant true/false, and a SHORT reason (≤12 words).\n\n` +
    `=== PAIRS ===\n${listing}\n`;
  const out = await structuredCreate<{ verdicts?: Array<{ index?: number; redundant?: boolean; reason?: string }> }>({
    stage: 'diversity-judge',
    model: ROUTES.RESUME_PIPELINE,
    maxTokens: 8192,
    prompt,
    schema: JUDGE_TOOL.input_schema as Record<string, unknown>,
  });
  for (const r of out?.verdicts ?? []) {
    if (typeof r?.index === 'number') m.set(r.index, { redundant: !!r.redundant, reason: r.reason ?? '' });
  }
  return m;
}

export async function diversifySelection(
  orderedIds: string[],
  pool: CandidatePool,
  _jdText: string,
): Promise<DiversityReport> {
  const byId = new Map(pool.claims.map((c) => [c.id, c]));
  const rank = new Map(orderedIds.map((id, i) => [id, i])); // SELECT rank (lower = higher priority)
  const gk = (id: string) => byId.get(id)?.groupKey ?? '';
  // Per-entity reselection pool: selectable claims in deterministic pool (source) order.
  const entityPool = new Map<string, Claim[]>();
  for (const c of pool.claims) {
    if (!isSelectableClaim(c)) continue;
    (entityPool.get(c.groupKey) ?? entityPool.set(c.groupKey, []).get(c.groupKey)!).push(c);
  }

  let working = [...orderedIds];
  const verdicts: DiversityVerdict[] = [];
  const decisions: DiversityDecision[] = [];
  const everDropped = new Set<string>(); // never re-add a claim we already dropped
  let passes = 0;

  for (let pass = 0; pass < 3; pass++) {
    // Same-entity pairs among the current working set.
    const groups = new Map<string, string[]>();
    for (const id of working) (groups.get(gk(id)) ?? groups.set(gk(id), []).get(gk(id))!).push(id);
    const pairs: PairIn[] = [];
    for (const ids of groups.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = byId.get(ids[i])!, b = byId.get(ids[j])!;
        pairs.push({ idA: ids[i], textA: a.text, idB: ids[j], textB: b.text, entity: a.entity });
      }
    }
    if (!pairs.length) break;
    passes = pass + 1;

    const vmap = await judgePairs(pairs);
    const pairIndex = new Map<string, number>(); // "idA|idB" / "idB|idA" → pair index
    pairs.forEach((p, i) => { pairIndex.set(`${p.idA}|${p.idB}`, i); pairIndex.set(`${p.idB}|${p.idA}`, i); });
    pairs.forEach((p, i) => {
      const v = vmap.get(i) ?? { redundant: false, reason: '(no verdict returned)' };
      verdicts.push({ entity: p.entity, idA: p.idA, textA: p.textA, idB: p.idB, textB: p.textB, redundant: v.redundant, reason: v.reason, pass: passes });
    });
    const isRedundant = (x: string, y: string) => {
      const i = pairIndex.get(`${x}|${y}`);
      return i !== undefined && (vmap.get(i)?.redundant ?? false);
    };

    // Greedy keep-first in SELECT rank order; drop a claim redundant with an already-kept one.
    const toDrop = new Set<string>();
    for (const ids of groups.values()) {
      const ranked = [...ids].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
      const kept: string[] = [];
      for (const id of ranked) {
        if (kept.some((k) => isRedundant(k, id))) toDrop.add(id);
        else kept.push(id);
      }
    }
    if (!toDrop.size) break;

    // Apply drops; reselect next non-used grounded claim per entity (pool order).
    const dropsByEntity = new Map<string, string[]>();
    for (const id of working) if (toDrop.has(id)) (dropsByEntity.get(gk(id)) ?? dropsByEntity.set(gk(id), []).get(gk(id))!).push(id);
    for (const id of toDrop) everDropped.add(id);

    const newWorking = working.filter((id) => !toDrop.has(id));
    const inUse = new Set<string>([...newWorking, ...everDropped]); // never re-add a dropped/used claim
    for (const [entity, dropped] of dropsByEntity) {
      const cands = (entityPool.get(entity) ?? []).filter((c) => !inUse.has(c.id));
      for (let i = 0; i < dropped.length; i++) {
        const dc = byId.get(dropped[i])!;
        const cand = cands[i] ?? null; // next-in-pool-order, parallel to the i-th drop
        if (cand) { newWorking.push(cand.id); inUse.add(cand.id); }
        decisions.push({
          entity: dc.entity,
          dropped: dropped[i], droppedText: dc.text,
          reason: 'redundant with a higher-ranked kept claim',
          reselected: cand?.id ?? null, reselectedText: cand?.text ?? null,
          pass: passes,
        });
      }
    }
    working = newWorking;
  }

  return { orderedIds: working, verdicts, decisions, passes };
}
