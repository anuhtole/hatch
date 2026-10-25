'use client';

/**
 * components/resume/ResumeStudio.tsx — the in-app résumé builder (B-9).
 *
 * Flow: pick/create a target (name + URLs and/or pasted description — the B-8
 * fetch-target shape) → run the pipeline server-side with streamed stage
 * progress (same fail-fast stages as the CLI; a failed gate stops the run and
 * is shown verbatim — there is NO skip affordance) → results view (page PNG,
 * .docx downloads, gap report) → interview cards whose answers become
 * PendingAction vault writes (standard approve/discard card; Hatch never
 * proposes or pre-fills an answer).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PendingActionCard from '@/components/chat/PendingActionCard';
// B-44: OutreachPanel is no longer inlined here — it lives on the per-target detail
// route (app/resume/[target] → TargetDetail), which mounts it for research targets.

// ── Palette (Hatch light theme — backdrop #F5F0EB / surface #FFFFFF / accent #7EB8D6) ──
// B-44: folded to the app's slate-blue tokens (app/globals.css :root) — retires the
// pre-pivot #7EB8D6 palette drift. green/red kept as literals (no token equivalent).
const C = {
  card: '#FFFFFF',
  cardAlt: 'var(--accent-blue-tint)',
  text: 'var(--text-primary)',
  dim: 'var(--text-secondary)',
  accent: 'var(--accent-blue)',
  accentInk: 'var(--accent-blue-ink)',
  green: '#5BB98C',
  red: '#D4645C',
  border: 'var(--hairline)',
};
const mono = 'var(--font-jetbrains-mono), ui-monospace, monospace';

// B-43: canonical seed targets are hard-protected — no delete control is shown for
// them and the API refuses (403). Mirrors PROTECTED in the delete route.
const PROTECTED = new Set(['chai', 'bair', 'industry-pm']);
// B-43: interview-prep Q&A is hidden (UI-only). The backend is left dormant and
// intact (/api/resume/interview/* + interview-core.ts + interview.ts). Flip to
// true to restore the in-app interview cards.
const SHOW_INTERVIEW = false;

// ── Types (mirror the API routes) ───────────────────────────────────────────────
interface TargetRow {
  name: string; title: string; urls: string[]; hasPastedText: boolean;
  kind?: 'research' | 'industry'; // B-44: derived in GET /api/resume/targets (labRoot presence)
  hasRun: boolean; hasGapReport: boolean; lastRunAt: string | null;
}
interface StageEvent { name: string; status: 'start' | 'pass' | 'fail'; detail?: string }
interface RunArtifacts {
  resume: string; resumePdf?: string; coverLetter: string; png: string; gapReport: string;
  skillsToLearn: string; selectionDiff: string;
}
interface GapQuestionRow { requirement: string; question: string; source?: string }
interface EntityRow { name: string; kind: string; sourcePath: string }
interface AnswerCard { id: string; summary: string }

export default function ResumeStudio() {
  const router = useRouter();
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [hasSelectionDiff, setHasSelectionDiff] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  // new-target form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fUrls, setFUrls] = useState('');
  const [fPasted, setFPasted] = useState('');

  // run state
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [runError, setRunError] = useState<{ stage: string; detail: string } | null>(null);
  const [artifacts, setArtifacts] = useState<RunArtifacts | null>(null);
  const [pngBust, setPngBust] = useState(0);

  // interview state
  const [questions, setQuestions] = useState<GapQuestionRow[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dest, setDest] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<Record<string, AnswerCard>>({});
  const [dismissed, setDismissed] = useState<Record<string, string>>({}); // key → 'skipped'|'suppressed'
  const [answeredCount, setAnsweredCount] = useState(0);

  const qKey = (q: GapQuestionRow) => `${q.requirement}::${q.question}`;

  const loadTargets = useCallback(async () => {
    const r = await fetch('/api/resume/targets');
    if (!r.ok) return;
    const data = await r.json();
    setTargets(data.targets ?? []);
    setHasSelectionDiff(Boolean(data.hasSelectionDiff));
  }, []);

  useEffect(() => { void loadTargets(); }, [loadTargets]);

  const loadQuestions = useCallback(async (target: string) => {
    const r = await fetch(`/api/resume/interview/questions?target=${encodeURIComponent(target)}`);
    if (!r.ok) { setQuestions([]); setEntities([]); return; }
    const data = await r.json();
    setQuestions(data.questions ?? []);
    setEntities(data.entities ?? []);
  }, []);

  // B-44: selecting an existing target now navigates to its detail route
  // (/resume/<name> → TargetDetail), which owns the artifacts + outreach view.
  // The inline Run/Results below remain the build surface for the create-and-run flow.
  const openTarget = useCallback((name: string) => {
    router.push(`/resume/${encodeURIComponent(name)}`);
  }, [router]);

  // ── Run the pipeline with streamed progress ──────────────────────────────────
  const run = useCallback(async (body: Record<string, unknown>, targetName: string) => {
    setRunning(true);
    setStages([]); setLogLines([]); setRunError(null); setArtifacts(null);
    setQuestions([]); setCards({}); setDismissed({}); setAnsweredCount(0);
    try {
      const res = await fetch('/api/resume/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setRunError({ stage: 'request', detail: err.error ?? `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === 'stage') {
            const se = { name: String(ev.name), status: ev.status as StageEvent['status'], detail: ev.detail as string | undefined };
            setStages((prev) => {
              const i = prev.findIndex((s) => s.name === se.name);
              if (i >= 0) { const next = [...prev]; next[i] = se; return next; }
              return [...prev, se];
            });
          } else if (ev.t === 'log') {
            setLogLines((prev) => [...prev, String(ev.line)]);
          } else if (ev.t === 'error') {
            setRunError({ stage: String(ev.stage), detail: String(ev.detail) });
          } else if (ev.t === 'result') {
            setArtifacts(ev.artifacts as RunArtifacts);
            setPngBust(Date.now());
          }
        }
      }
      await loadTargets();
      await loadQuestions(targetName);
    } finally {
      setRunning(false);
    }
  }, [loadTargets, loadQuestions]);

  const runExisting = (name: string) => { setActive(name); void run({ target: name }, name); };
  const runNew = () => {
    const name = fName.trim().toLowerCase();
    const urls = fUrls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!name) return;
    setActive(name);
    setShowForm(false);
    void run({ def: { name, title: fTitle.trim() || name, urls, pastedText: fPasted.trim() } }, name);
  };

  // ── Delete-resume (B-43): typed-confirm, hard-protects canonical targets ────────
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const openDelete = (name: string) => { setDeleteName(name); setDeleteInput(''); setDeleteErr(null); };
  const confirmDelete = useCallback(async () => {
    if (!deleteName || deleteInput !== deleteName) return; // guard: typed name must match
    setDeleteBusy(true); setDeleteErr(null);
    try {
      const r = await fetch(`/api/resume/targets/${encodeURIComponent(deleteName)}`, { method: 'DELETE' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setTargets((prev) => prev.filter((t) => t.name !== deleteName));
      if (active === deleteName) { setActive(null); setArtifacts(null); setQuestions([]); }
      setDeleteName(null); setDeleteInput('');
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteName, deleteInput, active]);

  // ── Interview actions ─────────────────────────────────────────────────────────
  const submitAnswer = async (q: GapQuestionRow) => {
    const key = qKey(q);
    const answer = (answers[key] ?? '').trim();
    if (!answer) return;
    const r = await fetch('/api/resume/interview/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q.question, requirement: q.requirement, answer,
        entitySourcePath: dest[key] || null,
      }),
    });
    if (r.ok) {
      const data = await r.json();
      setCards((prev) => ({ ...prev, [key]: { id: data.id, summary: data.summary } }));
      setAnsweredCount((n) => n + 1);
    }
  };
  const suppress = async (q: GapQuestionRow) => {
    await fetch('/api/resume/interview/suppress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: q.requirement, question: q.question }),
    });
    setDismissed((prev) => ({ ...prev, [qKey(q)]: 'suppressed' }));
  };

  // ── Render helpers ────────────────────────────────────────────────────────────
  const sectionTitle = (label: string) => (
    <div style={{ fontSize: 11, fontFamily: mono, color: C.dim, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '18px 0 10px' }}>
      {label}
    </div>
  );
  const card = (children: React.ReactNode, key?: string) => (
    <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
      {children}
    </div>
  );
  const btn = (label: string, onClick: () => void, opts: { disabled?: boolean; color?: string } = {}) => (
    <button
      onClick={onClick}
      disabled={opts.disabled}
      style={{
        background: opts.disabled ? C.cardAlt : (opts.color ?? C.accent), color: opts.disabled ? C.dim : '#FFFFFF',
        border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontFamily: mono,
        fontWeight: 700, cursor: opts.disabled ? 'default' : 'pointer', marginRight: 8,
      }}
    >
      {label}
    </button>
  );

  const activeTarget = targets.find((t) => t.name === active);

  return (
    <div style={{ color: C.text, maxWidth: 980 }}>
      <div style={{ fontSize: 20, fontWeight: 600, fontFamily: mono, marginBottom: 4 }}>Resume Studio</div>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
        Vault-grounded tailoring: every bullet traces to your real records; gates stop the run on any violation.
      </div>

      {/* ── Targets ─────────────────────────────────────────────────────────── */}
      {sectionTitle('Targets')}
      {/* B-44: roster LIST — each row opens the per-target detail route (/resume/<name>). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {targets.map((t) => {
          const isProtected = PROTECTED.has(t.name);
          const isResearch = t.kind === 'research';
          return (
            <div key={t.name} style={{ position: 'relative', display: 'flex' }}>
              <button
                onClick={() => openTarget(t.name)}
                style={{
                  flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                  background: C.card, color: C.text, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '10px 12px', paddingRight: 36, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</span>
                  <span style={{ display: 'block', fontSize: 11, color: C.dim, fontFamily: mono, marginTop: 2 }}>
                    {t.name} · {t.hasRun ? `last run ${new Date(t.lastRunAt!).toLocaleString()}` : 'not run yet'}
                  </span>
                </span>
                <span style={{
                  fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0,
                  background: isResearch ? C.cardAlt : 'transparent',
                  color: isResearch ? C.accentInk : C.dim,
                  border: `1px solid ${isResearch ? C.accent : C.border}`,
                }}>
                  {isResearch ? 'Research' : 'Industry'}
                </span>
              </button>
              {isProtected ? (
                <span
                  title="Canonical target — protected, cannot be deleted"
                  aria-label="protected target"
                  style={{ position: 'absolute', top: 8, right: 10, fontSize: 10, opacity: 0.55, color: C.dim, pointerEvents: 'none' }}
                >🔒</span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); openDelete(t.name); }}
                  title={`Delete resume ${t.name}`}
                  aria-label={`Delete resume ${t.name}`}
                  style={{
                    position: 'absolute', top: 6, right: 6, width: 20, height: 20, padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', background: 'transparent', borderRadius: 5, cursor: 'pointer',
                    fontSize: 15, lineHeight: 1, color: C.dim,
                  }}
                >×</button>
              )}
            </div>
          );
        })}
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ alignSelf: 'flex-start', background: C.cardAlt, color: C.accent, border: `1px dashed ${C.accent}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontFamily: mono }}
        >
          + new target
        </button>
      </div>

      {showForm && card(
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: C.dim }}>
            A target is a name + one or more URLs and/or a pasted description (lab page, group page, job posting).
          </div>
          <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="short id, e.g. bair"
            style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: mono }} />
          <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="display title (optional)"
            style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13 }} />
          <textarea value={fUrls} onChange={(e) => setFUrls(e.target.value)} placeholder="URLs, one per line" rows={3}
            style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: mono }} />
          <textarea value={fPasted} onChange={(e) => setFPasted(e.target.value)} placeholder="pasted description (optional)" rows={4}
            style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13 }} />
          <div>{btn(running ? 'running…' : 'Save & run pipeline', runNew, { disabled: running || !fName.trim() })}</div>
        </div>,
      )}

      {activeTarget && !running && (
        <div style={{ marginBottom: 6 }}>
          {btn(activeTarget.hasRun ? `Re-run pipeline for "${activeTarget.title}"` : `Run pipeline for "${activeTarget.title}"`, () => runExisting(activeTarget.name), { disabled: running })}
        </div>
      )}

      {/* ── Run progress ───────────────────────────────────────────────────────── */}
      {(stages.length > 0 || running) && (
        <>
          {sectionTitle('Pipeline')}
          {card(
            <div>
              {stages.map((s) => (
                <div key={s.name} style={{ display: 'flex', gap: 8, fontSize: 12, fontFamily: mono, padding: '3px 0' }}>
                  <span style={{ color: s.status === 'fail' ? C.red : s.status === 'pass' ? C.green : C.accent, width: 14 }}>
                    {s.status === 'fail' ? '✗' : s.status === 'pass' ? '✓' : '…'}
                  </span>
                  <span style={{ minWidth: 150 }}>{s.name}</span>
                  <span style={{ color: C.dim, flex: 1 }}>{s.detail ?? ''}</span>
                </div>
              ))}
              {running && <div style={{ color: C.dim, fontSize: 12, fontFamily: mono, paddingTop: 4 }}>working…</div>}
              {logLines.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: C.dim, cursor: 'pointer', fontFamily: mono }}>log ({logLines.length} lines)</summary>
                  <pre style={{ fontSize: 11, color: C.dim, whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto', margin: '6px 0 0' }}>
                    {logLines.join('\n')}
                  </pre>
                </details>
              )}
            </div>,
          )}
          {runError && card(
            <div>
              <div style={{ color: C.red, fontFamily: mono, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                ✗ STAGE FAILED: {runError.stage}
              </div>
              <pre style={{ fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', margin: 0 }}>{runError.detail}</pre>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
                The run stopped at this gate. Fix the cause and re-run — gates cannot be skipped.
              </div>
            </div>,
          )}
        </>
      )}

      {/* ── Results ────────────────────────────────────────────────────────────── */}
      {artifacts && !runError && (
        <>
          {sectionTitle('Results')}
          {card(
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${artifacts.png}?v=${pngBust}`}
                alt="rendered résumé page"
                style={{ width: 280, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}
              />
              <div style={{ display: 'grid', gap: 8, alignContent: 'start', fontSize: 13, fontFamily: mono }}>
                <a href={artifacts.resume} style={{ color: C.accent }}>⬇ tailored-resume.docx</a>
                {artifacts.resumePdf && <a href={artifacts.resumePdf} style={{ color: C.accent }}>⬇ resume.pdf</a>}
                <a href={artifacts.coverLetter} style={{ color: C.accent }}>⬇ cover-letter.docx</a>
                <a href={artifacts.gapReport} target="_blank" style={{ color: C.accent }}>gap-report.json ↗</a>
                <a href={artifacts.skillsToLearn} target="_blank" style={{ color: C.accent }}>skills-to-learn.json ↗ (study list — never rendered)</a>
                {hasSelectionDiff && <a href={artifacts.selectionDiff} target="_blank" style={{ color: C.accent }}>selection-diff.md ↗ (multi-target)</a>}
              </div>
            </div>,
          )}
        </>
      )}

      {/* ── Interview ──────────────────────────────────────────────────────────── */}
      {/* B-43: interview-prep Q&A hidden (UI-only via SHOW_INTERVIEW=false). Backend
          left dormant + intact: /api/resume/interview/* routes, interview-core.ts,
          interview.ts. Results (incl. gap-report.json + skills-to-learn.json), Targets,
          Run, and Outreach are unchanged. Flip SHOW_INTERVIEW to restore. */}
      {SHOW_INTERVIEW && questions.length > 0 && (
        <>
          {sectionTitle(`Interview — ${questions.length} open question(s)`)}
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>
            Answers are stored VERBATIM in your vault as grounded claims after you approve the
            write. Hatch never proposes or pre-fills an answer — type your own words.
          </div>
          {questions.map((q) => {
            const key = qKey(q);
            const done = cards[key];
            const gone = dismissed[key];
            if (gone) return null;
            return card(
              <div>
                <div style={{ fontSize: 11, fontFamily: mono, color: C.accent, marginBottom: 4 }}>
                  {q.requirement}{q.source ? <> · <a href={q.source} target="_blank" style={{ color: C.dim }}>research ↗</a></> : null}
                </div>
                <div style={{ fontSize: 14, marginBottom: 8 }}>{q.question}</div>
                {!done && (
                  <>
                    <textarea
                      value={answers[key] ?? ''}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="your answer, in your own words (stored verbatim)"
                      rows={3}
                      style={{ width: '100%', background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <select
                        value={dest[key] ?? ''}
                        onChange={(e) => setDest((prev) => ({ ...prev, [key]: e.target.value }))}
                        style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, fontFamily: mono }}
                      >
                        <option value="">→ general (context only, never a résumé bullet)</option>
                        {entities.map((e) => (
                          <option key={e.sourcePath} value={e.sourcePath}>→ {e.name} ({e.kind})</option>
                        ))}
                      </select>
                      {btn('Submit for approval', () => void submitAnswer(q), { disabled: !(answers[key] ?? '').trim() })}
                      {btn('Skip', () => setDismissed((prev) => ({ ...prev, [key]: 'skipped' })), { color: C.cardAlt })}
                      {btn("Don't ask again", () => void suppress(q), { color: C.cardAlt })}
                    </div>
                  </>
                )}
                {done && (
                  <div style={{ marginTop: 4 }}>
                    <PendingActionCard actionId={done.id} actionType="vault_write" summary={done.summary} />
                  </div>
                )}
              </div>,
              key,
            );
          })}
          {answeredCount > 0 && active && (
            <div style={{ marginTop: 10 }}>
              {btn(`Re-run pipeline for "${active}" with new claims`, () => runExisting(active), { disabled: running })}
              <span style={{ fontSize: 11, color: C.dim, fontFamily: mono }}>
                approve the pending writes above first — new claims flow through all guards
              </span>
            </div>
          )}
        </>
      )}

      {/* B-44: Outreach moved to the per-target detail route (app/resume/[target] →
          TargetDetail), where it renders for research targets. No longer inlined here. */}

      {/* ── Delete-resume modal (B-43): typed-name confirm for a destructive op ── */}
      {deleteName && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!deleteBusy) setDeleteName(null); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(26,26,26,0.38)', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20,
              width: '100%', maxWidth: 400, boxShadow: '0 12px 32px rgba(26,26,26,0.18)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, marginBottom: 8 }}>
              Delete resume “{deleteName}”?
            </div>
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.55, marginBottom: 12 }}>
              This removes its definition (<code>targets/{deleteName}.json</code>) and all rendered
              artifacts (<code>out/{deleteName}/</code>). It can’t be undone. Type{' '}
              <b style={{ color: C.text }}>{deleteName}</b> to confirm.
            </div>
            <input
              autoFocus
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && deleteInput === deleteName && !deleteBusy) void confirmDelete(); }}
              placeholder={deleteName}
              disabled={deleteBusy}
              style={{
                width: '100%', boxSizing: 'border-box', background: C.cardAlt, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, fontSize: 13, fontFamily: mono, marginBottom: 12,
              }}
            />
            {deleteErr && (
              <div style={{ color: C.red, fontSize: 12, fontFamily: mono, marginBottom: 10 }}>{deleteErr}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteName(null)}
                disabled={deleteBusy}
                style={{
                  background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '7px 14px', fontSize: 12, fontFamily: mono, fontWeight: 700,
                  cursor: deleteBusy ? 'default' : 'pointer',
                }}
              >
                Cancel
              </button>
              {btn(deleteBusy ? 'Deleting…' : 'Delete resume', () => void confirmDelete(), {
                disabled: deleteBusy || deleteInput !== deleteName, color: C.red,
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
