'use client';

import { useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type ExperienceItem = {
  company: string;
  role: string;
  period: string;
  location: string;
  bullets: string[];
  sources: string[];
};

type ResearchItem = {
  title: string;
  institution: string;
  period: string;
  bullets: string[];
  sources: string[];
};

type ResumeData = {
  compiledAt: string;
  identity: {
    name: string;
    email: string;
    phone: string;
    linkedin: string;
    location: string;
    status: string;
    sources: string[];
  };
  education: {
    degrees: Array<{
      institution: string;
      expected: string;
      majors: string[];
      notes: string;
      sources: string[];
    }>;
    coursework: string[];
    currentCourses: string[];
    sources: string[];
  };
  experience: ExperienceItem[];
  projects: ResearchItem[];
  research: ResearchItem[];
  skills: {
    technical: string[];
    tools: string[];
    languages: string[];
    sources: string[];
  };
  interests: string[];
  recentActivity: Array<{
    date: string;
    type: string;
    description: string;
  }>;
  customSections?: Array<{ title: string; bullets: string[] }>;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    resume: '#7EB8D6',
    wiki: '#A78BDA',
    canvas: '#D4A56A',
    email: '#7EC99D',
    manual: '#B8B4AF',
  };
  const c = colors[source] ?? '#B8B4AF';
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: 'var(--font-jetbrains-mono)',
        padding: '2px 6px',
        borderRadius: 4,
        background: `${c}22`,
        color: c,
        border: `1px solid ${c}44`,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        marginRight: 4,
      }}
    >
      {source}
    </span>
  );
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
  editing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
};

function Section({ title, children, editing, onEdit, onSave, onCancel, saving }: SectionProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ marginBottom: 28, position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <h2
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#9B9BAB',
            fontFamily: 'var(--font-jetbrains-mono)',
            margin: 0,
          }}
        >
          {title}
        </h2>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onCancel}
              style={{
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid rgba(0,0,0,0.08)',
                background: '#FFFFFF',
                color: '#6B6B7B',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              style={{
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 999,
                border: 'none',
                background: saving ? '#B8E0F0' : '#1A1A1A',
                color: '#FFFFFF',
                cursor: saving ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          onEdit && (
            <button
              onClick={onEdit}
              style={{
                opacity: hover ? 1 : 0,
                transition: 'opacity 0.15s',
                fontSize: 13,
                padding: '3px 10px',
                borderRadius: 999,
                border: '1px solid rgba(0,0,0,0.08)',
                background: '#FFFFFF',
                color: '#9B9BAB',
                cursor: 'pointer',
              }}
              title="Edit section"
            >
              ✏
            </button>
          )
        )}
      </div>
      {children}
    </div>
  );
}

// Shared edit input style
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid #E8E4DF',
  borderRadius: 4,
  fontSize: 13,
  color: '#1A1A1A',
  fontFamily: 'inherit',
  background: '#FAFAF8',
  outline: 'none',
  boxSizing: 'border-box',
};

const smallInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontSize: 12,
  padding: '4px 7px',
};

function BulletEditor({
  bullets,
  onChange,
  dotColor = '#7EB8D6',
}: {
  bullets: string[];
  onChange: (bullets: string[]) => void;
  dotColor?: string;
}) {
  function update(i: number, val: string) {
    const next = [...bullets];
    next[i] = val;
    onChange(next);
  }
  function remove(i: number) {
    onChange(bullets.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...bullets];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add() {
    onChange([...bullets, '']);
  }

  return (
    <div style={{ marginTop: 6 }}>
      {bullets.map((b, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
          <input
            value={b}
            onChange={(e) => update(i, e.target.value)}
            style={{ ...smallInputStyle, flex: 1 }}
          />
          <button onClick={() => move(i, -1)} style={arrowBtn} title="Move up">↑</button>
          <button onClick={() => move(i, 1)} style={arrowBtn} title="Move down">↓</button>
          <button onClick={() => remove(i)} style={deleteBtn} title="Delete">×</button>
        </div>
      ))}
      <button onClick={add} style={addBulletBtn}>+ bullet</button>
    </div>
  );
}

const arrowBtn: React.CSSProperties = {
  padding: '2px 5px',
  fontSize: 11,
  border: '1px solid #E8E4DF',
  borderRadius: 3,
  background: '#FFFFFF',
  color: '#9B9BAB',
  cursor: 'pointer',
  lineHeight: 1,
};
const deleteBtn: React.CSSProperties = {
  ...arrowBtn,
  color: '#D4645C',
  borderColor: '#F0D0CE',
};
const addBulletBtn: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  padding: '3px 8px',
  border: '1px dashed #C8C4BF',
  borderRadius: 4,
  background: 'transparent',
  color: '#9B9BAB',
  cursor: 'pointer',
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function LivingResume() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editSection, setEditSection] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResumeData | null>(null);
  const [saving, setSaving] = useState(false);
  // "Add Section" state
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionBullets, setNewSectionBullets] = useState<string[]>(['']);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wiki/living-resume');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function compile() {
    setCompiling(true);
    try {
      await fetch('/api/wiki/living-resume/compile', { method: 'POST' });
      await load();
    } finally {
      setCompiling(false);
    }
  }

  function exportPdf() {
    window.open('/api/wiki/living-resume/export', '_blank');
  }

  useEffect(() => { load(); }, []);

  function startEditing(section: string) {
    if (!data) return;
    setDraft(JSON.parse(JSON.stringify(data)));
    setEditSection(section);
  }

  function cancelEdit() {
    setEditSection(null);
    setDraft(null);
  }

  async function saveEdit() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/wiki/living-resume/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: draft.identity,
          education: { degrees: draft.education.degrees, coursework: draft.education.coursework },
          experience: draft.experience.map(({ sources: _s, ...e }) => e),
          projects: draft.projects.map(({ sources: _s, ...p }) => p),
          research: draft.research.map(({ sources: _s, ...r }) => r),
          skills: { technical: draft.skills.technical, tools: draft.skills.tools, languages: draft.skills.languages },
          interests: draft.interests,
          customSections: draft.customSections ?? [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData({ ...draft });
      setEditSection(null);
      setDraft(null);
    } catch (e) {
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveNewSection() {
    if (!data || !newSectionTitle.trim()) return;
    const newCustom = {
      title: newSectionTitle.trim(),
      bullets: newSectionBullets.filter(Boolean),
    };
    const updatedData = {
      ...data,
      customSections: [...(data.customSections ?? []), newCustom],
    };
    setSaving(true);
    try {
      const res = await fetch('/api/wiki/living-resume/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: updatedData.identity,
          education: { degrees: updatedData.education.degrees, coursework: updatedData.education.coursework },
          experience: updatedData.experience.map(({ sources: _s, ...e }) => e),
          projects: updatedData.projects.map(({ sources: _s, ...p }) => p),
          research: updatedData.research.map(({ sources: _s, ...r }) => r),
          skills: { technical: updatedData.skills.technical, tools: updatedData.skills.tools, languages: updatedData.skills.languages },
          interests: updatedData.interests,
          customSections: updatedData.customSections ?? [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(updatedData);
      setAddingSection(false);
      setNewSectionTitle('');
      setNewSectionBullets(['']);
    } catch (e) {
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Draft mutators ──

  function setDraftField<K extends keyof ResumeData>(key: K, val: ResumeData[K]) {
    setDraft((prev) => prev ? { ...prev, [key]: val } : prev);
  }

  function updateExpField(i: number, field: keyof ExperienceItem, val: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const experience = prev.experience.map((e, j) => j === i ? { ...e, [field]: val } : e);
      return { ...prev, experience };
    });
  }

  function updateExpBullets(i: number, bullets: string[]) {
    setDraft((prev) => {
      if (!prev) return prev;
      const experience = prev.experience.map((e, j) => j === i ? { ...e, bullets } : e);
      return { ...prev, experience };
    });
  }

  function addExpItem() {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, experience: [...prev.experience, { company: '', role: '', period: '', location: '', bullets: [], sources: ['manual'] }] };
    });
  }

  function removeExpItem(i: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, experience: prev.experience.filter((_, j) => j !== i) };
    });
  }

  function updateListItemField(
    list: 'projects' | 'research',
    i: number,
    field: keyof ResearchItem,
    val: string,
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [list]: prev[list].map((item, j) => j === i ? { ...item, [field]: val } : item),
      };
    });
  }

  function updateListItemBullets(list: 'projects' | 'research', i: number, bullets: string[]) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [list]: prev[list].map((item, j) => j === i ? { ...item, bullets } : item),
      };
    });
  }

  function addListItem(list: 'projects' | 'research') {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [list]: [...prev[list], { title: '', institution: '', period: '', bullets: [], sources: ['manual'] }] };
    });
  }

  function removeListItem(list: 'projects' | 'research', i: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, [list]: prev[list].filter((_, j) => j !== i) };
    });
  }

  // ── Loading / error states ──

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9B9BAB', fontSize: 14 }}>
        Compiling resume…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ color: '#D4645C', fontSize: 14, fontWeight: 500 }}>Failed to load Living Resume</div>
        {error && <div style={{ color: '#9B9BAB', fontSize: 13, maxWidth: 360, textAlign: 'center' }}>{error}</div>}
        <button
          onClick={load}
          style={{
            padding: '8px 20px', borderRadius: 999, border: 'none',
            background: '#1A1A1A', color: '#FFFFFF',
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, marginTop: 4,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const compiledDate = new Date(data.compiledAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // d is draft when editing, data otherwise
  const d = editSection && draft ? draft : data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid rgba(255,235,210,0.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#221E2A',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: '#766D62', fontFamily: 'var(--font-jetbrains-mono)', flex: 1 }}>
          Compiled {compiledDate}
        </span>
        <button
          onClick={compile}
          disabled={compiling}
          style={{
            padding: '7px 16px',
            borderRadius: 999,
            border: '1px solid rgba(126,184,214,0.3)',
            background: 'transparent',
            color: compiling ? '#766D62' : '#A89E91',
            fontSize: 12,
            cursor: compiling ? 'default' : 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
        >
          {compiling ? 'Recompiling…' : 'Recompile'}
        </button>
        <button
          onClick={exportPdf}
          style={{
            padding: '7px 16px',
            borderRadius: 999,
            border: 'none',
            background: '#7EB8D6',
            color: '#17141C',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
          }}
        >
          Export PDF
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          {/* ── Identity ─────────────────────────────────────── */}
          <Section
            title="Identity"
            editing={editSection === 'identity'}
            onEdit={() => startEditing('identity')}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
          >
            {editSection === 'identity' && draft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>NAME</div>
                    <input value={draft.identity.name} onChange={(e) => setDraftField('identity', { ...draft.identity, name: e.target.value })} style={inputStyle} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>STATUS</div>
                    <input value={draft.identity.status} onChange={(e) => setDraftField('identity', { ...draft.identity, status: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>LOCATION</div>
                    <input value={draft.identity.location} onChange={(e) => setDraftField('identity', { ...draft.identity, location: e.target.value })} style={inputStyle} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>EMAIL</div>
                    <input value={draft.identity.email} onChange={(e) => setDraftField('identity', { ...draft.identity, email: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>PHONE</div>
                    <input value={draft.identity.phone} onChange={(e) => setDraftField('identity', { ...draft.identity, phone: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>LINKEDIN</div>
                    <input value={draft.identity.linkedin} onChange={(e) => setDraftField('identity', { ...draft.identity, linkedin: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1A1A1A', letterSpacing: '-0.02em', margin: 0 }}>
                    {data.identity.name}
                  </h1>
                  <div style={{ display: 'flex', gap: 4, paddingTop: 6 }}>
                    {data.identity.sources.map((s) => <SourceBadge key={s} source={s} />)}
                  </div>
                </div>
                <div style={{ color: '#6B6B7B', fontSize: 13, lineHeight: 1.7 }}>
                  <div>{data.identity.status}</div>
                  <div>{data.identity.location}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <a href={`mailto:${data.identity.email}`} style={{ color: '#7EB8D6', textDecoration: 'none' }}>{data.identity.email}</a>
                    <span>{data.identity.phone}</span>
                    <a href={`https://${data.identity.linkedin}`} target="_blank" rel="noreferrer" style={{ color: '#7EB8D6', textDecoration: 'none' }}>{data.identity.linkedin}</a>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Education ─────────────────────────────────────── */}
          <Section
            title="Education"
            editing={editSection === 'education'}
            onEdit={() => startEditing('education')}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
          >
            {editSection === 'education' && draft ? (
              <div>
                {draft.education.degrees.map((deg, i) => (
                  <div key={i} style={{ marginBottom: 14, padding: 10, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 2 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>INSTITUTION</div>
                        <input
                          value={deg.institution}
                          onChange={(e) => {
                            const degrees = draft.education.degrees.map((d, j) => j === i ? { ...d, institution: e.target.value } : d);
                            setDraftField('education', { ...draft.education, degrees });
                          }}
                          style={inputStyle}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>EXPECTED</div>
                        <input
                          value={deg.expected}
                          onChange={(e) => {
                            const degrees = draft.education.degrees.map((d, j) => j === i ? { ...d, expected: e.target.value } : d);
                            setDraftField('education', { ...draft.education, degrees });
                          }}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>NOTES</div>
                      <input
                        value={deg.notes}
                        onChange={(e) => {
                          const degrees = draft.education.degrees.map((d, j) => j === i ? { ...d, notes: e.target.value } : d);
                          setDraftField('education', { ...draft.education, degrees });
                        }}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>RELEVANT COURSEWORK (comma-separated)</div>
                  <textarea
                    value={draft.education.coursework.join(', ')}
                    onChange={(e) => {
                      const coursework = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                      setDraftField('education', { ...draft.education, coursework });
                    }}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
              </div>
            ) : (
              <div>
                {data.education.degrees.map((deg, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A' }}>{deg.institution}</div>
                        <div style={{ color: '#6B6B7B', fontSize: 13 }}>{deg.majors.join(' · ')}</div>
                        {deg.notes && <div style={{ color: '#9B9BAB', fontSize: 12, marginTop: 2 }}>{deg.notes}</div>}
                      </div>
                      <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0, marginLeft: 16 }}>
                        Expected {deg.expected}
                      </div>
                    </div>
                  </div>
                ))}
                {data.education.coursework.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Relevant Coursework</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.education.coursework.map((c, i) => (
                        <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#F0EDEA', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6B6B7B' }}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {data.education.currentCourses.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Courses</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.education.currentCourses.map((c, i) => (
                        <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#E8F2F8', border: '1px solid #7EB8D644', fontSize: 12, color: '#7EB8D6' }}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Experience ─────────────────────────────────────── */}
          <Section
            title="Professional Experience"
            editing={editSection === 'experience'}
            onEdit={() => startEditing('experience')}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
          >
            {editSection === 'experience' && draft ? (
              <div>
                {draft.experience.map((exp, i) => (
                  <div key={i} style={{ marginBottom: 16, padding: 10, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>COMPANY</div>
                        <input value={exp.company} onChange={(e) => updateExpField(i, 'company', e.target.value)} style={smallInputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>ROLE</div>
                        <input value={exp.role} onChange={(e) => updateExpField(i, 'role', e.target.value)} style={smallInputStyle} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>PERIOD</div>
                        <input value={exp.period} onChange={(e) => updateExpField(i, 'period', e.target.value)} style={smallInputStyle} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>LOCATION</div>
                        <input value={exp.location} onChange={(e) => updateExpField(i, 'location', e.target.value)} style={smallInputStyle} />
                      </div>
                    </div>
                    <BulletEditor bullets={exp.bullets} onChange={(b) => updateExpBullets(i, b)} dotColor="#7EB8D6" />
                    <button onClick={() => removeExpItem(i)} style={{ ...deleteBtn, marginTop: 8, fontSize: 11, padding: '3px 8px' }}>Remove role</button>
                  </div>
                ))}
                <button onClick={addExpItem} style={{ ...addBulletBtn, padding: '5px 12px', marginTop: 4 }}>+ Add role</button>
              </div>
            ) : (
              <div>
                {data.experience.map((exp, i) => (
                  <div key={i} style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A' }}>{exp.company}</div>
                        <div style={{ color: '#6B6B7B', fontSize: 13 }}>{exp.role}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                        <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)' }}>{exp.period}</div>
                        {exp.location && <div style={{ fontSize: 11, color: '#B8B4AF' }}>{exp.location}</div>}
                      </div>
                    </div>
                    {exp.bullets.length > 0 && (
                      <ul style={{ margin: '6px 0 0 0', paddingLeft: 0, listStyle: 'none' }}>
                        {exp.bullets.map((b, j) => (
                          <li key={j} style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, marginBottom: 3, position: 'relative', paddingLeft: 12 }}>
                            <span style={{ position: 'absolute', left: 0, top: 8, width: 4, height: 4, borderRadius: '50%', background: '#7EB8D6' }} />
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Projects ─────────────────────────────────────── */}
          {(data.projects.length > 0 || editSection === 'projects') && (
            <Section
              title="Projects"
              editing={editSection === 'projects'}
              onEdit={() => startEditing('projects')}
              onSave={saveEdit}
              onCancel={cancelEdit}
              saving={saving}
            >
              {editSection === 'projects' && draft ? (
                <div>
                  {draft.projects.map((p, i) => (
                    <div key={i} style={{ marginBottom: 16, padding: 10, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 2 }}>
                          <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>TITLE</div>
                          <input value={p.title} onChange={(e) => updateListItemField('projects', i, 'title', e.target.value)} style={smallInputStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>PERIOD</div>
                          <input value={p.period} onChange={(e) => updateListItemField('projects', i, 'period', e.target.value)} style={smallInputStyle} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>LOCATION / INSTITUTION</div>
                        <input value={p.institution} onChange={(e) => updateListItemField('projects', i, 'institution', e.target.value)} style={smallInputStyle} />
                      </div>
                      <BulletEditor bullets={p.bullets} onChange={(b) => updateListItemBullets('projects', i, b)} dotColor="#7EC99D" />
                      <button onClick={() => removeListItem('projects', i)} style={{ ...deleteBtn, marginTop: 8, fontSize: 11, padding: '3px 8px' }}>Remove project</button>
                    </div>
                  ))}
                  <button onClick={() => addListItem('projects')} style={{ ...addBulletBtn, padding: '5px 12px', marginTop: 4 }}>+ Add project</button>
                </div>
              ) : (
                <div>
                  {data.projects.map((p, i) => (
                    <div key={i} style={{ marginBottom: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A' }}>{p.title}</div>
                          <div style={{ color: '#6B6B7B', fontSize: 13 }}>{p.institution}</div>
                        </div>
                        <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0, marginLeft: 16 }}>{p.period}</div>
                      </div>
                      {p.bullets.length > 0 && (
                        <ul style={{ margin: '6px 0 0 0', paddingLeft: 0, listStyle: 'none' }}>
                          {p.bullets.map((b, j) => (
                            <li key={j} style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, marginBottom: 3, position: 'relative', paddingLeft: 12 }}>
                              <span style={{ position: 'absolute', left: 0, top: 8, width: 4, height: 4, borderRadius: '50%', background: '#7EC99D' }} />
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── Research ─────────────────────────────────────── */}
          {(data.research.length > 0 || editSection === 'research') && (
            <Section
              title="Research"
              editing={editSection === 'research'}
              onEdit={() => startEditing('research')}
              onSave={saveEdit}
              onCancel={cancelEdit}
              saving={saving}
            >
              {editSection === 'research' && draft ? (
                <div>
                  {draft.research.map((r, i) => (
                    <div key={i} style={{ marginBottom: 16, padding: 10, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 2 }}>
                          <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>TITLE</div>
                          <input value={r.title} onChange={(e) => updateListItemField('research', i, 'title', e.target.value)} style={smallInputStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>PERIOD</div>
                          <input value={r.period} onChange={(e) => updateListItemField('research', i, 'period', e.target.value)} style={smallInputStyle} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 3, fontFamily: 'var(--font-jetbrains-mono)' }}>INSTITUTION</div>
                        <input value={r.institution} onChange={(e) => updateListItemField('research', i, 'institution', e.target.value)} style={smallInputStyle} />
                      </div>
                      <BulletEditor bullets={r.bullets} onChange={(b) => updateListItemBullets('research', i, b)} dotColor="#A78BDA" />
                      <button onClick={() => removeListItem('research', i)} style={{ ...deleteBtn, marginTop: 8, fontSize: 11, padding: '3px 8px' }}>Remove</button>
                    </div>
                  ))}
                  <button onClick={() => addListItem('research')} style={{ ...addBulletBtn, padding: '5px 12px', marginTop: 4 }}>+ Add research</button>
                </div>
              ) : (
                <div>
                  {data.research.map((r, i) => (
                    <div key={i} style={{ marginBottom: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#1A1A1A' }}>{r.title}</div>
                          <div style={{ color: '#6B6B7B', fontSize: 13 }}>{r.institution}</div>
                        </div>
                        <div style={{ fontSize: 12, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0, marginLeft: 16 }}>{r.period}</div>
                      </div>
                      {r.bullets.length > 0 && (
                        <ul style={{ margin: '6px 0 0 0', paddingLeft: 0, listStyle: 'none' }}>
                          {r.bullets.map((b, j) => (
                            <li key={j} style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, marginBottom: 3, position: 'relative', paddingLeft: 12 }}>
                              <span style={{ position: 'absolute', left: 0, top: 8, width: 4, height: 4, borderRadius: '50%', background: '#A78BDA' }} />
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── Skills & Languages ─────────────────────────────────────── */}
          <Section
            title="Skills & Languages"
            editing={editSection === 'skills'}
            onEdit={() => startEditing('skills')}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
          >
            {editSection === 'skills' && draft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>TECHNICAL (comma-separated)</div>
                  <textarea
                    value={draft.skills.technical.join(', ')}
                    onChange={(e) => setDraftField('skills', { ...draft.skills, technical: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    rows={2}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>PLATFORMS & TOOLS (comma-separated)</div>
                  <textarea
                    value={draft.skills.tools.join(', ')}
                    onChange={(e) => setDraftField('skills', { ...draft.skills, tools: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    rows={2}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>LANGUAGES (one per line)</div>
                  <BulletEditor bullets={draft.skills.languages} onChange={(langs) => setDraftField('skills', { ...draft.skills, languages: langs })} dotColor="#9B9BAB" />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.skills.technical.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Technical</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.skills.technical.map((s, i) => (
                        <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#F0EDEA', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6B6B7B' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {data.skills.tools.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Platforms & Tools</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.skills.tools.map((s, i) => (
                        <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#F0EDEA', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6B6B7B' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {data.skills.languages.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#9B9BAB', fontFamily: 'var(--font-jetbrains-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Languages</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.skills.languages.map((s, i) => (
                        <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#F0EDEA', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6B6B7B' }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Interests ─────────────────────────────────────── */}
          <Section
            title="Interests"
            editing={editSection === 'interests'}
            onEdit={() => startEditing('interests')}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
          >
            {editSection === 'interests' && draft ? (
              <div>
                <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>INTERESTS (comma-separated)</div>
                <textarea
                  value={draft.interests.join(', ')}
                  onChange={(e) => setDraftField('interests', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.interests.map((interest, i) => (
                  <span key={i} style={{ padding: '3px 8px', borderRadius: 4, background: '#F0EDEA', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, color: '#6B6B7B' }}>{interest}</span>
                ))}
              </div>
            )}
          </Section>

          {/* ── Recent Activity ─────────────────────────────────────── */}
          {data.recentActivity.length > 0 && (
            <Section title="Recent Activity">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.recentActivity.map((a, i) => {
                  const typeColors: Record<string, string> = {
                    email: '#7EC99D',
                    assignment: '#D4A56A',
                    wiki: '#A78BDA',
                    sync: '#7EB8D6',
                  };
                  const color = typeColors[a.type] ?? '#B8B4AF';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < data.recentActivity.length - 1 ? '1px solid #F0EDE8' : 'none' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: '#6B6B7B', flex: 1 }}>{a.description}</span>
                      <span style={{ fontSize: 11, color: '#B8B4AF', fontFamily: 'var(--font-jetbrains-mono)', flexShrink: 0 }}>
                        {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Custom sections ─────────────────────────────────────── */}
          {(data.customSections ?? []).map((cs, ci) => (
            <Section key={ci} title={cs.title}>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {cs.bullets.map((b, bi) => (
                  <li key={bi} style={{ fontSize: 13, color: '#6B6B7B', lineHeight: 1.6, marginBottom: 3, position: 'relative', paddingLeft: 12 }}>
                    <span style={{ position: 'absolute', left: 0, top: 8, width: 4, height: 4, borderRadius: '50%', background: '#B8B4AF' }} />
                    {b}
                  </li>
                ))}
              </ul>
            </Section>
          ))}

          {/* ── Add Section ─────────────────────────────────────── */}
          {!addingSection ? (
            <button
              onClick={() => setAddingSection(true)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px dashed #C8C4BF',
                borderRadius: 6,
                background: 'transparent',
                color: '#9B9BAB',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 28,
              }}
            >
              + Add Section
            </button>
          ) : (
            <div style={{ marginBottom: 28, padding: 14, border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10 }}>
              <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>SECTION TITLE</div>
              <input
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                placeholder="e.g. Awards, Certifications…"
                style={{ ...inputStyle, marginBottom: 10 }}
                autoFocus
              />
              <div style={{ fontSize: 11, color: '#9B9BAB', marginBottom: 6, fontFamily: 'var(--font-jetbrains-mono)' }}>BULLETS</div>
              <BulletEditor bullets={newSectionBullets} onChange={setNewSectionBullets} dotColor="#B8B4AF" />
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button
                  onClick={() => { setAddingSection(false); setNewSectionTitle(''); setNewSectionBullets(['']); }}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 4, border: '1px solid #E8E4DF', background: '#FFFFFF', color: '#6B6B7B', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveNewSection}
                  disabled={saving || !newSectionTitle.trim()}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: 'none', background: '#7EB8D6', color: '#FFFFFF', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                >
                  {saving ? 'Saving…' : 'Add Section'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
