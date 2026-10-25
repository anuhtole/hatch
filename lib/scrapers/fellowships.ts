/**
 * Fellowship opportunity catalog.
 * Static program data for quick display; deadline fields updated manually or via refresh.
 */

export interface Opportunity {
  id: string;
  name: string;
  org: string;
  category: 'fellowship' | 'research' | 'grant' | 'policy';
  url: string;
  deadline: string | null;      // "Oct 1" / "Rolling" / null
  cycle: string;                // "Annual" / "Biannual" / etc.
  fit: 'primary' | 'secondary' | 'adjacent';
  notes: string;
  dismissed?: boolean;
}

export const FELLOWSHIPS: Opportunity[] = [
  {
    id: 'rhodes',
    name: 'Rhodes Scholarship',
    org: 'Rhodes Trust',
    category: 'fellowship',
    url: 'https://www.rhodeshouse.ox.ac.uk/scholarships/the-rhodes-scholarship/',
    deadline: 'Oct 1 (campus deadline)',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'Oxford postgrad. Strong in civic leadership + academic excellence. Apply junior year for senior year.',
  },
  {
    id: 'marshall',
    name: 'Marshall Scholarship',
    org: 'Marshall Aid Commemoration Commission',
    category: 'fellowship',
    url: 'https://www.marshallscholarship.org/',
    deadline: 'Sep–Oct (campus deadline)',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'UK grad study. Especially strong for policy/research track. Two-year award.',
  },
  {
    id: 'gates-cambridge',
    name: 'Gates Cambridge Scholarship',
    org: 'Gates Foundation / Cambridge',
    category: 'fellowship',
    url: 'https://www.gatescambridge.org/',
    deadline: 'Oct 12',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'Cambridge postgrad. Emphasis on improving lives of others + intellectual ability.',
  },
  {
    id: 'churchill',
    name: 'Churchill Scholarship',
    org: 'Winston Churchill Foundation',
    category: 'fellowship',
    url: 'https://www.winstonchurchillfoundation.org/',
    deadline: 'Nov 1',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'Churchill College Cambridge for STEM grad study. Math/CS background fits well.',
  },
  {
    id: 'schwarzman',
    name: 'Schwarzman Scholars',
    org: 'Schwarzman College of Computing',
    category: 'fellowship',
    url: 'https://www.schwarzmanscholars.org/',
    deadline: 'Sep 28',
    cycle: 'Annual',
    fit: 'primary',
    notes: 'Tsinghua. MBA-style leadership program focused on US-China relations + global leadership. PM + AI angle strong.',
  },
  {
    id: 'knight-hennessy',
    name: 'Knight-Hennessy Scholars',
    org: 'Stanford University',
    category: 'fellowship',
    url: 'https://knight-hennessy.stanford.edu/',
    deadline: 'Oct 12',
    cycle: 'Annual',
    fit: 'primary',
    notes: 'Stanford grad school funding for any degree. Need a Stanford grad school offer first.',
  },
  {
    id: 'fulbright',
    name: 'Fulbright U.S. Student Program',
    org: 'U.S. Dept. of State',
    category: 'fellowship',
    url: 'https://us.fulbrightonline.org/',
    deadline: 'Oct 15 (campus deadline)',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'Study/research/ETA abroad. Spain connection is strong given current abroad semester.',
  },
  {
    id: 'hertz',
    name: 'Hertz Foundation Fellowship',
    org: 'Hertz Foundation',
    category: 'fellowship',
    url: 'https://www.hertzfoundation.org/the-fellowship/',
    deadline: 'Oct 25',
    cycle: 'Annual',
    fit: 'secondary',
    notes: 'Applied math/science PhD funding. Strong fit given applied math major + research interests.',
  },
  {
    id: 'nsf-grfp',
    name: 'NSF Graduate Research Fellowship',
    org: 'National Science Foundation',
    category: 'fellowship',
    url: 'https://www.nsfgrfp.org/',
    deadline: 'Oct (varies by field)',
    cycle: 'Annual',
    fit: 'primary',
    notes: '$37k/yr stipend + $12k tuition. Apply senior year or first grad year. CS/Applied Math tracks.',
  },
  {
    id: 'watson',
    name: 'Watson Fellowship',
    org: 'Thomas J. Watson Foundation',
    category: 'fellowship',
    url: 'https://watson.foundation/fellowships/tj',
    deadline: 'Nov (campus nominations)',
    cycle: 'Annual',
    fit: 'adjacent',
    notes: 'Year-abroad post-graduation for independent project. Berkeley nominates ~5/year.',
  },
  {
    id: 'pd-soros',
    name: 'Paul & Daisy Soros Fellowships',
    org: 'PD Soros',
    category: 'fellowship',
    url: 'https://www.pdsoros.org/',
    deadline: 'Nov 1',
    cycle: 'Annual',
    fit: 'adjacent',
    notes: 'For "New Americans" — immigrants/children of immigrants. Check eligibility.',
  },
];
