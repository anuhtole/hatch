// Tier definitions for contact categorization
// Tier 0 = AI Labs, Tier 1 = Big Tech, Tier 2 = High-Growth Startups,
// Tier 3 = Finance/Quant, Tier 4 = VC, Tier 5 = C-Suite/Founders,
// Tier 6 = Professors & Researchers, Tier 7 = Lawyers

export type ContactTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const TIER_LABELS: Record<ContactTier, string> = {
  0: 'AI Labs',
  1: 'Big Tech',
  2: 'High-Growth Startups',
  3: 'Finance & Quant',
  4: 'Venture Capital',
  5: 'C-Suite & Founders',
  6: 'Academia & Research',
  7: 'Law',
};

const AI_LABS = new Set([
  'openai', 'anthropic', 'deepmind', 'google deepmind', 'google brain',
  'meta ai', 'meta fair', 'microsoft research', 'cohere', 'mistral',
  'inflection', 'stability ai', 'hugging face', 'scale ai',
  'together ai', 'perplexity', 'character ai', 'x ai', 'xai',
  'imbue', 'aleph alpha', 'adept', 'ai21 labs',
]);

const BIG_TECH = new Set([
  'google', 'alphabet', 'meta', 'facebook', 'microsoft', 'apple', 'amazon',
  'aws', 'netflix', 'uber', 'lyft', 'airbnb', 'twitter', 'x corp',
  'linkedin', 'salesforce', 'oracle', 'ibm', 'intel', 'nvidia', 'amd',
  'qualcomm', 'adobe', 'autodesk', 'servicenow', 'workday', 'splunk',
  'databricks', 'snowflake', 'palantir', 'crowdstrike', 'datadog',
  'cloudflare', 'twilio', 'stripe', 'square', 'block', 'paypal',
  'shopify', 'zendesk', 'okta', 'pagerduty', 'atlassian', 'slack',
  'zoom', 'dropbox', 'box', 'docusign', 'veeva', 'workiva',
  'samsung', 'sony', 'lg', 'toshiba', 'hitachi', 'nec', 'fujitsu',
  'ericsson', 'nokia', 'sap', 'siemens',
]);

const FINANCE_QUANT = new Set([
  'jane street', 'citadel', 'two sigma', 'de shaw', 'renaissance technologies',
  'hudson river trading', 'virtu', 'akuna capital', 'sig', 'susquehanna',
  'optiver', 'flow traders', 'jump trading', 'tower research', 'imc',
  'blackrock', 'vanguard', 'fidelity', 'morgan stanley', 'goldman sachs',
  'jpmorgan', 'jp morgan', 'bank of america', 'wells fargo', 'citigroup',
  'citi', 'ubs', 'credit suisse', 'barclays', 'deutsche bank', 'hsbc',
  'lazard', 'evercore', 'jefferies', 'raymond james', 'piper sandler',
  'point72', 'millennium', 'bridgewater', 'aqr', 'man group',
]);

const VC_FIRMS = new Set([
  'sequoia', 'andreessen horowitz', 'a16z', 'benchmark', 'kleiner perkins',
  'greylock', 'accel', 'founders fund', 'lightspeed', 'general catalyst',
  'bessemer', 'nea', 'idc ventures', 'insight partners', 'tiger global',
  'coatue', 'softbank', 'vision fund', 'khosla ventures', 'first round',
  'index ventures', 'balderton', 'atomico', 'redpoint', 'true ventures',
  'flatiron health', 'union square ventures', 'lowercase capital',
  'social capital', 'lux capital', 'dcm', 'gv', 'google ventures',
  'm12', 'microsoft m12', 'intel capital', 'qualcomm ventures',
  'yc', 'y combinator',
]);

const LAW_KEYWORDS = ['law', 'legal', 'llp', 'llc attorney', 'counsel', 'legal services'];

const UNIVERSITY_KEYWORDS = [
  'university', 'college', 'institute of technology', 'school of',
  'polytechnic', 'academia', 'research lab', 'national lab',
];

// Non-tech job title keywords to filter out
const NON_TECH_TITLE_KEYWORDS = [
  'nurse', 'nursing', 'rn ', ' rn', 'registered nurse', 'lpn', 'cna',
  'physician', 'doctor', 'md ', ' md', 'dentist', 'pharmacist', 'therapist',
  'teacher', 'educator', 'principal', 'superintendent', 'professor',
  'artist', 'painter', 'sculptor', 'illustrator', 'art director',
  'social worker', 'counselor', 'pastor', 'minister', 'priest', 'clergy',
  'realtor', 'real estate agent', 'mortgage broker',
];

// UC3M / Spanish study abroad identifiers
const STUDY_ABROAD_COMPANIES = new Set([
  'universidad carlos iii', 'uc3m', 'carlos iii', 'universidad complutense',
  'ie university', 'ie business school', 'esade', 'iese',
]);

const PRESTIGIOUS_SCHOOLS = new Set([
  'mit', 'stanford', 'harvard', 'uc berkeley', 'caltech', 'carnegie mellon',
  'princeton', 'yale', 'columbia', 'upenn', 'university of pennsylvania',
  'cornell', 'brown', 'dartmouth', 'duke', 'northwestern', 'johns hopkins',
  'ucla', 'ucsd', 'usc', 'nyu', 'michigan', 'ut austin', 'georgia tech',
  'purdue', 'illinois', 'waterloo', 'toronto', 'oxford', 'cambridge',
  'epfl', 'eth zurich', 'imperial college',
]);

function normalizeCompany(company: string): string {
  return company.toLowerCase().trim();
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}

function matchesSet(value: string, set: Set<string>): boolean {
  const norm = value.toLowerCase();
  for (const entry of set) {
    if (norm.includes(entry)) return true;
  }
  return false;
}

export function isTechContact(contact: {
  company?: string | null;
  position?: string | null;
  school?: string | null;
}): boolean {
  const company = contact.company ?? '';
  const position = contact.position ?? '';
  const school = contact.school ?? '';

  // Filter out UC3M / Spanish study abroad
  if (matchesSet(company, STUDY_ABROAD_COMPANIES)) return false;
  if (matchesSet(school, STUDY_ABROAD_COMPANIES)) return false;

  // Filter out non-tech titles at non-tech companies
  const titleNorm = normalizeTitle(position);
  const isNonTechTitle = NON_TECH_TITLE_KEYWORDS.some((kw) => titleNorm.includes(kw));
  if (isNonTechTitle) {
    // Allow if at a clearly tech/finance company
    const companyNorm = normalizeCompany(company);
    const isTechCompany =
      matchesSet(companyNorm, AI_LABS) ||
      matchesSet(companyNorm, BIG_TECH) ||
      matchesSet(companyNorm, FINANCE_QUANT);
    if (!isTechCompany) return false;
  }

  return true;
}

export function categorizeContact(contact: {
  company?: string | null;
  position?: string | null;
  school?: string | null;
}): { tier: ContactTier; category: string } {
  const company = normalizeCompany(contact.company ?? '');
  const position = normalizeTitle(contact.position ?? '');
  const school = (contact.school ?? '').toLowerCase();

  if (matchesSet(company, AI_LABS)) return { tier: 0, category: TIER_LABELS[0] };
  if (matchesSet(company, BIG_TECH)) return { tier: 1, category: TIER_LABELS[1] };
  if (matchesSet(company, FINANCE_QUANT)) return { tier: 3, category: TIER_LABELS[3] };
  if (matchesSet(company, VC_FIRMS)) return { tier: 4, category: TIER_LABELS[4] };

  // Professors & researchers
  const isAcademia =
    UNIVERSITY_KEYWORDS.some((kw) => company.includes(kw)) ||
    position.includes('professor') ||
    position.includes('researcher') ||
    position.includes('phd') ||
    position.includes('postdoc') ||
    position.includes('faculty') ||
    position.includes('lecturer');
  if (isAcademia) return { tier: 6, category: TIER_LABELS[6] };

  // Law
  const isLaw =
    LAW_KEYWORDS.some((kw) => company.includes(kw)) ||
    position.includes('attorney') ||
    position.includes('lawyer') ||
    position.includes('esquire') ||
    position.includes('paralegal') ||
    position.includes('legal counsel');
  if (isLaw) return { tier: 7, category: TIER_LABELS[7] };

  // C-Suite / Founders
  const isCSuite =
    position.includes('ceo') ||
    position.includes('cto') ||
    position.includes('coo') ||
    position.includes('cfo') ||
    position.includes('co-founder') ||
    position.includes('cofounder') ||
    position.includes('founder') ||
    position.includes('managing director') ||
    position.includes('general partner');
  if (isCSuite) return { tier: 5, category: TIER_LABELS[5] };

  // Default: High-Growth Startups
  return { tier: 2, category: TIER_LABELS[2] };
}

export function subcategorizeContact(position?: string | null): string {
  if (!position) return 'Other';
  const t = position.toLowerCase();

  if (
    t.includes('machine learning') || t.includes('ml ') || t.includes(' ml') ||
    t.includes('artificial intelligence') || t.includes('ai engineer') ||
    t.includes('deep learning') || t.includes('nlp') || t.includes('computer vision')
  ) return 'ML / AI';

  if (
    t.includes('product manager') || t.includes('product management') ||
    t.includes('program manager') || t.includes(' pm ') || t.includes('(pm)')
  ) return 'Product Management';

  if (
    t.includes('data scientist') || t.includes('data science') ||
    t.includes('data analyst') || t.includes('analytics') ||
    t.includes('business intelligence') || t.includes('bi analyst')
  ) return 'Data Science & Analytics';

  if (
    t.includes('software engineer') || t.includes('software developer') ||
    t.includes('swe ') || t.includes(' swe') || t.includes('full stack') ||
    t.includes('fullstack') || t.includes('backend') || t.includes('frontend') ||
    t.includes('web developer')
  ) return 'Software Engineering';

  if (
    t.includes('devops') || t.includes('site reliability') || t.includes('sre ') ||
    t.includes('infrastructure') || t.includes('platform engineer') ||
    t.includes('cloud engineer') || t.includes('systems engineer')
  ) return 'DevOps & Infrastructure';

  if (
    t.includes('ux') || t.includes('ui ') || t.includes(' ui') ||
    t.includes('design') || t.includes('designer') || t.includes('product design')
  ) return 'Design';

  if (
    t.includes('strategy') || t.includes('business development') ||
    t.includes('operations') || t.includes('consultant') ||
    t.includes('associate') || t.includes('analyst')
  ) return 'Business & Strategy';

  return 'Other';
}

export function schoolPrestige(school?: string | null): number {
  if (!school) return 0;
  const s = school.toLowerCase();
  for (const name of PRESTIGIOUS_SCHOOLS) {
    if (s.includes(name)) return 1;
  }
  return 0;
}

export function companyPrestige(company?: string | null): number {
  if (!company) return 0;
  const c = company.toLowerCase();
  if (matchesSet(c, AI_LABS)) return 3;
  if (matchesSet(c, BIG_TECH)) return 2;
  if (matchesSet(c, FINANCE_QUANT)) return 2;
  if (matchesSet(c, VC_FIRMS)) return 1;
  return 0;
}

export function seniority(position?: string | null): number {
  if (!position) return 0;
  const t = position.toLowerCase();
  if (t.includes('vp') || t.includes('vice president') || t.includes('ceo') ||
      t.includes('cto') || t.includes('coo') || t.includes('cfo') ||
      t.includes('founder') || t.includes('partner') || t.includes('director')) return 3;
  if (t.includes('senior') || t.includes('lead') || t.includes('principal') ||
      t.includes('staff')) return 2;
  if (t.includes('manager') || t.includes('manager')) return 1;
  return 0;
}
