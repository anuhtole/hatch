'use client';

/**
 * components/resume/TargetDetail.tsx — per-target detail view (B-44).
 *
 * Reached at /resume/<target>. Reads the target row from GET /api/resume/targets
 * (which derives `kind` from labRoot presence) and branches:
 *   RESEARCH  → the outreach surface (<OutreachPanel mode="detail">).
 *   INDUSTRY  → an application container (apply links + artifacts + an inert
 *               "submit application" slot for B-45).
 * App slate-blue tokens only. No send/draft/approve wiring lives here.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import OutreachPanel from '@/components/resume/OutreachPanel';

const C = {
  card: '#FFFFFF',
  cardAlt: 'var(--accent-blue-tint)',
  text: 'var(--text-primary)',
  dim: 'var(--text-secondary)',
  accent: 'var(--accent-blue)',
  accentInk: 'var(--accent-blue-ink)',
  border: 'var(--hairline)',
};
const mono = 'var(--font-jetbrains-mono), ui-monospace, monospace';

interface TargetRow {
  name: string; title: string; urls: string[];
  kind?: 'research' | 'industry';
  hasPastedText: boolean; hasRun: boolean; hasGapReport: boolean; lastRunAt: string | null;
}

export default function TargetDetail({ target }: { target: string }) {
  const [row, setRow] = useState<TargetRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setPreviewFailed(false); // reset preview resilience state on (re)navigation
      const r = await fetch('/api/resume/targets');
      const data = await r.json();
      const found: TargetRow | undefined = (data.targets ?? []).find((t: TargetRow) => t.name === target);
      setRow(found ?? null);
      if (found?.hasRun) {
        // Optional: read the precise completion time; tolerate 404 (falls back to lastRunAt).
        try {
          const lg = await fetch(`/api/resume/artifact/${encodeURIComponent(target)}/last-green.json`);
          if (lg.ok) { const j = await lg.json(); setCompletedAt(j.completedAt ?? null); }
        } catch { /* not run yet / unreadable — fall back */ }
      }
    } finally {
      setLoaded(true);
    }
  }, [target]);

  useEffect(() => { void load(); }, [load]);

  const art = (file: string) => `/api/resume/artifact/${encodeURIComponent(target)}/${file}`;
  const lastRun = completedAt ?? row?.lastRunAt ?? null;

  // ── Unknown target ──────────────────────────────────────────────────────────
  if (loaded && !row) {
    return (
      <div style={{ color: C.text, maxWidth: 720 }}>
        <Link href="/resume" style={{ color: C.accent, fontFamily: mono, fontSize: 12 }}>← Resume Studio</Link>
        <div style={{ marginTop: 16, fontSize: 16, fontWeight: 700 }}>Unknown target “{target}”</div>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 6 }}>
          No target by that name. It may have been deleted. <Link href="/resume" style={{ color: C.accent }}>Back to the roster</Link>.
        </div>
      </div>
    );
  }
  if (!loaded || !row) {
    return <div style={{ color: C.dim, fontFamily: mono, fontSize: 13 }}>Loading…</div>;
  }

  const isResearch = row.kind === 'research';

  return (
    <div style={{ color: C.text, maxWidth: 980 }}>
      <Link href="/resume" style={{ color: C.accent, fontFamily: mono, fontSize: 12 }}>← Resume Studio</Link>

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 2px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{row.title}</div>
        <span style={{
          fontFamily: mono, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          background: isResearch ? C.cardAlt : 'transparent',
          color: isResearch ? C.accentInk : C.dim,
          border: `1px solid ${isResearch ? C.accent : C.border}`,
        }}>
          {isResearch ? 'Research' : 'Industry'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.dim, fontFamily: mono, marginBottom: 16 }}>
        {row.name} · {lastRun ? `last run ${new Date(lastRun).toLocaleString()}` : 'not run yet'}
      </div>

      {/* ── Quick artifacts ────────────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontFamily: mono, color: C.dim, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Artifacts</div>
      {row.hasRun ? (
        <div style={{ marginBottom: 18, display: 'grid', gap: 12 }}>
          {/* PNG preview of the tailored résumé — mirrors the Studio Results img,
              cache-busted by last-run so a Studio re-run busts it on next nav.
              onError keeps a missing PNG from ever breaking the layout. */}
          {previewFailed ? (
            <div style={{ fontSize: 12, color: C.dim, fontFamily: mono }}>
              Preview unavailable — open the .docx below.
            </div>
          ) : (
            <a href={art('resume.pdf')} target="_blank" rel="noreferrer" style={{ width: 280, display: 'block' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${art('visual/tailored-resume.docx.png')}?v=${encodeURIComponent(lastRun ?? '')}`}
                alt="Tailored resume preview"
                onError={() => setPreviewFailed(true)}
                style={{ width: 280, display: 'block', border: `1px solid ${C.border}`, borderRadius: 8, background: 'var(--bg-paper)', boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}
              />
            </a>
          )}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'grid', gap: 8, fontSize: 13, fontFamily: mono }}>
            <a href={art('tailored-resume.docx')} style={{ color: C.accent }}>⬇ tailored-resume.docx</a>
            <a href={art('resume.pdf')} style={{ color: C.accent }}>⬇ resume.pdf</a>
            <a href={art('cover-letter.docx')} style={{ color: C.accent }}>⬇ cover-letter.docx</a>
            <a href={art('gap-report.json')} target="_blank" style={{ color: C.accent }}>gap-report.json ↗</a>
            <a href={art('skills-to-learn.json')} target="_blank" style={{ color: C.accent }}>skills-to-learn.json ↗ (study list — never rendered)</a>
          </div>
        </div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 18, fontSize: 13, color: C.dim }}>
          No artifacts yet. Run the pipeline in <Link href="/resume" style={{ color: C.accent }}>Resume Studio</Link> to generate the tailored résumé + cover letter.
        </div>
      )}

      {/* ── Branch: research outreach vs industry application ──────────────────── */}
      {isResearch ? (
        <OutreachPanel lab={target} mode="detail" />
      ) : (
        <div>
          <div style={{ fontSize: 11, fontFamily: mono, color: C.dim, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 8px' }}>Application</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'grid', gap: 10 }}>
            {row.urls.length > 0 ? (
              <div style={{ display: 'grid', gap: 6, fontSize: 13, fontFamily: mono }}>
                {row.urls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" style={{ color: C.accent }}>Application page ↗ <span style={{ color: C.dim }}>{u}</span></a>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.dim }}>No application URL on file for this target.</div>
            )}
            {row.hasRun && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, fontFamily: mono }}>
                <a href={art('tailored-resume.docx')} style={{ color: C.accent }}>⬇ résumé</a>
                <a href={art('cover-letter.docx')} style={{ color: C.accent }}>⬇ cover letter</a>
              </div>
            )}
            {/* Inert slot — application submission lands in B-45 (presentational only). */}
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.cardAlt }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>Submit application</div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: mono, marginBottom: 8 }}>
                Apply through the published page above; tracked in-app submission — coming in B-45.
              </div>
              <button type="button" disabled style={{ background: C.card, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 11, fontFamily: mono, fontWeight: 700, cursor: 'not-allowed' }}>
                Submit application (B-45)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
