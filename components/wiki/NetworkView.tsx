'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  company?: string | null;
  position?: string | null;
  school?: string | null;
  major?: string | null;
  linkedinUrl?: string | null;
  category?: string | null;
  subcategory?: string | null;
  tier?: number | null;
  connectedOn?: string | null;
  enrichedAt?: string | null;
}

interface Stats {
  total: number;
  enriched: number;
  unenriched: number;
  companiesCount: number;
  byCategory: Array<{ category: string; count: number }>;
  topCompanies: Array<{ company: string; count: number }>;
}

const TIER_COLORS: Record<number, string> = {
  0: '#A78BDA',
  1: '#3E9B94',
  2: '#5BB98C',
  3: '#E0A458',
  4: '#D4645C',
  5: 'var(--text-tertiary)',
  6: 'var(--text-secondary)',
  7: 'var(--text-tertiary)',
};

const TIER_LABELS: Record<number, string> = {
  0: 'AI Labs',
  1: 'Big Tech',
  2: 'High-Growth Startups',
  3: 'Finance & Quant',
  4: 'Venture Capital',
  5: 'C-Suite & Founders',
  6: 'Academia & Research',
  7: 'Law',
};

const SUBCATEGORY_OPTIONS = [
  'All Roles',
  'ML / AI',
  'Product Management',
  'Software Engineering',
  'Data Science & Analytics',
  'DevOps & Infrastructure',
  'Design',
  'Business & Strategy',
  'Other',
];

const SORT_OPTIONS = [
  { value: 'tier', label: 'Tier' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'school', label: 'School' },
];

export default function NetworkView() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubcategory, setFilterSubcategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState('tier');

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{
    enriched: number;
    total: number;
    current: string;
  } | null>(null);
  const enrichingRef = useRef(false);

  const fetchContacts = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterCategory) params.set('category', filterCategory);
    if (filterSubcategory) params.set('subcategory', filterSubcategory);
    if (searchQuery) params.set('search', searchQuery);
    params.set('sort', sort);
    const res = await fetch(`/api/network/contacts?${params.toString()}`);
    const data = await res.json() as { contacts: Contact[] };
    setContacts(data.contacts ?? []);
  }, [filterCategory, filterSubcategory, searchQuery, sort]);

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/network/stats');
    const data = await res.json() as Stats;
    setStats(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchContacts(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchContacts, fetchStats]);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('replace', 'true');
    try {
      const res = await fetch('/api/network/import', { method: 'POST', body: formData });
      const text = await res.text();
      let data: { total?: number; imported?: number; filtered?: number; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: `Server error (${res.status})${text ? ': ' + text.slice(0, 120) : ''}` };
      }
      if (data.error) {
        setImportResult(`Error: ${data.error}`);
      } else {
        setImportResult(`Imported ${data.imported} contacts (${data.filtered} filtered out) from ${data.total} total`);
        await Promise.all([fetchContacts(), fetchStats()]);
      }
    } catch (err) {
      setImportResult(`Error: ${String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function startEnrichment() {
    if (enrichingRef.current) return;
    enrichingRef.current = true;
    setEnriching(true);
    setEnrichProgress(null);

    const runNext = async () => {
      if (!enrichingRef.current) return;
      try {
        const res = await fetch('/api/network/enrich', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json() as {
          done?: boolean;
          ok?: boolean;
          enriched?: number;
          total?: number;
          remaining?: number;
          name?: string;
          error?: string;
        };
        if (data.done || data.error || !enrichingRef.current) {
          enrichingRef.current = false;
          setEnriching(false);
          setEnrichProgress(null);
          await Promise.all([fetchContacts(), fetchStats()]);
          return;
        }
        setEnrichProgress({ enriched: data.enriched ?? 0, total: data.total ?? 0, current: data.name ?? '' });
        if ((data.remaining ?? 0) > 0) {
          await runNext();
        } else {
          enrichingRef.current = false;
          setEnriching(false);
          setEnrichProgress(null);
          await Promise.all([fetchContacts(), fetchStats()]);
        }
      } catch {
        enrichingRef.current = false;
        setEnriching(false);
        setEnrichProgress(null);
      }
    };

    await runNext();
  }

  function stopEnrichment() {
    enrichingRef.current = false;
    setEnriching(false);
    setEnrichProgress(null);
  }

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCSV() {
    const params = new URLSearchParams();
    if (filterCategory) params.set('category', filterCategory);
    if (filterSubcategory) params.set('subcategory', filterSubcategory);
    if (searchQuery) params.set('search', searchQuery);
    window.open(`/api/network/export?${params.toString()}`);
  }

  const grouped = contacts.reduce<Record<string, Contact[]>>((acc, c) => {
    const key = c.category ?? 'Uncategorized';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  const tierOrder = [0, 1, 2, 3, 4, 5, 6, 7];
  const groupKeys = sort === 'tier'
    ? [
        ...tierOrder.map((t) => TIER_LABELS[t]).filter((label) => grouped[label]),
        ...Object.keys(grouped).filter((k) => !Object.values(TIER_LABELS).includes(k)),
      ]
    : Object.keys(grouped).sort();

  const allCategories = stats?.byCategory.map((b) => b.category) ?? [];

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Stats bar */}
      {stats && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid rgba(0,0,0,0.04)',
          borderRadius: 20,
          padding: '16px 20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
            {stats.total} tech contacts across {stats.companiesCount} companies
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {stats.byCategory.slice(0, 6).map((b) => {
              const tier = Object.entries(TIER_LABELS).find(([, label]) => label === b.category)?.[0];
              const color = tier != null ? TIER_COLORS[Number(tier)] : 'var(--text-tertiary)';
              return (
                <div key={b.category} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-jetbrains-mono)',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  {b.category}: {b.count}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category pill tabs */}
      {allCategories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="pill-tabs" style={{ flexWrap: 'wrap', height: 'auto' }}>
            <button
              className={`pill-tab${filterCategory === '' ? ' active' : ''}`}
              onClick={() => setFilterCategory('')}
            >
              All
            </button>
            {allCategories.map((cat) => {
              const tier = Object.entries(TIER_LABELS).find(([, label]) => label === cat)?.[0];
              const color = tier != null ? TIER_COLORS[Number(tier)] : 'var(--text-tertiary)';
              return (
                <button
                  key={cat}
                  className={`pill-tab${filterCategory === cat ? ' active' : ''}`}
                  onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
                  style={filterCategory === cat ? {} : { color: color }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + sub-filters + actions row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search contacts…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '8px 14px',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999,
            fontSize: 13,
            color: 'var(--text-primary)',
            background: '#FFFFFF',
            outline: 'none',
            minWidth: 200,
            fontFamily: 'var(--font-sans)',
          }}
        />

        {/* Subcategory filter */}
        <select
          value={filterSubcategory}
          onChange={(e) => setFilterSubcategory(e.target.value === 'All Roles' ? '' : e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999,
            fontSize: 13,
            color: filterSubcategory ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: '#FFFFFF',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          {SUBCATEGORY_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999,
            fontSize: 13,
            color: 'var(--text-secondary)',
            background: '#FFFFFF',
            outline: 'none',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>Sort: {o.label}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Enrichment */}
        {enrichProgress ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-jetbrains-mono)',
            background: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 999,
            padding: '7px 14px',
          }}>
            <span className="animate-pulse-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-blue)', display: 'inline-block' }} />
            {enrichProgress.enriched}/{enrichProgress.total} — {enrichProgress.current}
            <button
              onClick={stopEnrichment}
              style={{
                padding: '2px 8px',
                border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 999,
                fontSize: 11,
                cursor: 'pointer',
                background: '#F8F6F4',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-jetbrains-mono)',
              }}
            >Stop</button>
          </div>
        ) : (
          <button
            onClick={startEnrichment}
            disabled={enriching || (stats?.unenriched ?? 0) === 0}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 999,
              fontSize: 13,
              cursor: ((stats?.unenriched ?? 0) === 0) ? 'not-allowed' : 'pointer',
              background: ((stats?.unenriched ?? 0) === 0) ? '#F0EDEA' : 'var(--accent-blue-tint)',
              color: ((stats?.unenriched ?? 0) === 0) ? 'var(--text-tertiary)' : 'var(--accent-blue)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              transition: 'all 150ms ease',
            }}
          >
            {(stats?.unenriched ?? 0) === 0 ? 'All Enriched' : `Enrich ${stats?.unenriched ?? ''}`}
          </button>
        )}

        {/* Export */}
        <button
          onClick={exportCSV}
          style={{
            padding: '8px 16px',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999,
            fontSize: 13,
            cursor: 'pointer',
            background: '#FFFFFF',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F8F6F4'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#FFFFFF'; }}
        >Export CSV</button>

        {/* Import */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: 999,
            fontSize: 13,
            cursor: importing ? 'not-allowed' : 'pointer',
            background: 'var(--text-primary)',
            color: '#FFFFFF',
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            opacity: importing ? 0.6 : 1,
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => { if (!importing) (e.currentTarget as HTMLElement).style.background = '#2A2A2A'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = importing ? 'var(--text-primary)' : 'var(--text-primary)'; }}
        >
          {importing ? 'Importing…' : 'Import CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
      </div>

      {/* Import result banner */}
      {importResult && (
        <div style={{
          padding: '10px 16px',
          borderRadius: 12,
          fontSize: 13,
          background: importResult.startsWith('Error') ? 'rgba(212,100,92,0.08)' : 'rgba(91,185,140,0.08)',
          color: importResult.startsWith('Error') ? '#D4645C' : '#5BB98C',
          border: `1px solid ${importResult.startsWith('Error') ? 'rgba(212,100,92,0.2)' : 'rgba(91,185,140,0.2)'}`,
          fontFamily: 'var(--font-jetbrains-mono)',
        }}>
          {importResult}
        </div>
      )}

      {/* Contact list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-tertiary)', padding: '80px 20px',
          fontFamily: 'var(--font-sans)', fontSize: 16,
          background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.04)', borderRadius: 20,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⟁</div>
          No contacts yet. Import a LinkedIn CSV to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupKeys.map((groupKey) => {
            const groupContacts = grouped[groupKey] ?? [];
            if (groupContacts.length === 0) return null;

            const tier = Object.entries(TIER_LABELS).find(([, label]) => label === groupKey)?.[0];
            const color = tier != null ? TIER_COLORS[Number(tier)] : 'var(--text-tertiary)';
            const isCollapsed = collapsed.has(groupKey);

            return (
              <div key={groupKey} style={{
                background: '#FFFFFF',
                border: '1px solid rgba(0,0,0,0.04)',
                borderRadius: 16,
                overflow: 'hidden',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
                {/* Group header */}
                <button
                  onClick={() => toggleCollapsed(groupKey)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 20px', background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left',
                    borderBottom: isCollapsed ? 'none' : '1px solid rgba(0,0,0,0.05)',
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                    {groupKey}
                  </span>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-jetbrains-mono)',
                    color: '#FFFFFF', background: color,
                    padding: '2px 8px', borderRadius: 999, fontWeight: 500,
                  }}>
                    {groupContacts.length}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                </button>

                {/* Contact grid */}
                {!isCollapsed && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 1,
                    background: 'rgba(0,0,0,0.04)',
                  }}>
                    {groupContacts.map((c) => (
                      <ContactCard key={c.id} contact={c} tierColor={color} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactCard({ contact, tierColor }: { contact: Contact; tierColor: string }) {
  const [hovered, setHovered] = useState(false);

  const fullName = `${contact.firstName} ${contact.lastName}`;
  const titleAtCompany = [contact.position, contact.company].filter(Boolean).join(' @ ');
  const schoolInfo = [contact.school, contact.major].filter(Boolean).join(' · ');

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '14px 16px',
        background: hovered ? '#F8F6F4' : '#FFFFFF',
        transition: 'background 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {contact.linkedinUrl ? (
            <a
              href={contact.linkedinUrl.startsWith('http') ? contact.linkedinUrl : `https://${contact.linkedinUrl}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-blue)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            >
              {fullName}
            </a>
          ) : fullName}
        </span>
        {contact.enrichedAt && (
          <span style={{ fontSize: 10, color: '#5BB98C', fontFamily: 'var(--font-jetbrains-mono)' }}>✓</span>
        )}
      </div>

      {titleAtCompany && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>
          {titleAtCompany}
        </div>
      )}

      {schoolInfo && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)' }}>
          {schoolInfo}
        </div>
      )}

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
        {contact.subcategory && contact.subcategory !== 'Other' && (
          <span style={{
            padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontFamily: 'var(--font-jetbrains-mono)',
            background: `${tierColor}18`,
            color: tierColor, border: `1px solid ${tierColor}30`,
          }}>
            {contact.subcategory}
          </span>
        )}
        {contact.connectedOn && (
          <span style={{
            padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontFamily: 'var(--font-jetbrains-mono)',
            background: '#F0EDEA', color: 'var(--text-tertiary)',
            border: '1px solid rgba(0,0,0,0.06)',
          }}>
            {contact.connectedOn}
          </span>
        )}
      </div>
    </div>
  );
}
