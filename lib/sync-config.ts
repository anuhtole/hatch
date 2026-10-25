// Sync and file access restrictions for Hatch.
// Applied to: knowledge base sync, Drive search results, file processing.

export const EXCLUDED_SENDER_DOMAINS = [
  'turbotax.com',
  'intuit.com',
  'irs.gov',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citibank.com',
  'citi.com',
  'capitalone.com',
  'venmo.com',
  'paypal.com',
  'cash.app',
  'cashapp.com',
  'zelle.com',
  'robinhood.com',
  'fidelity.com',
  'schwab.com',
  'vanguard.com',
  'coinbase.com',
  'americanexpress.com',
  'discover.com',
  'salllemae.com',
  'navient.com',
  'nelnet.com',
  'sofi.com',
  'mint.com',
  'creditkarma.com',
];

export const EXCLUDED_SENDER_KEYWORDS = [
  'turbotax',
  'intuit',
  'internal revenue',
  'bank of america',
  'wells fargo',
  'capital one',
  'cash app',
  'charles schwab',
  'american express',
  'sallie mae',
  'your account',
  'statement ready',
  'transaction alert',
  'payment confirmation',
];

// Filename/path patterns — files matching any of these are excluded from
// Drive search results, knowledge base sync, and all file processing.
export const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  // Financial
  /\btax\b/i, /\bbank\b/i, /\bloan\b/i, /\bmortgage\b/i, /\bcredit\b/i,
  /\bpayroll\b/i, /\bsalary\b/i, /\bW-?2\b/i, /\b1099\b/, /\b401k\b/i,
  /\bIRA\b/, /\bbrokerage\b/i, /\bstatement\b/i, /\binvoice\b/i,
  /\bbilling\b/i, /\bSSN\b/i, /\brouting\b/i,
  // Personal identity
  /\bpassport\b/i, /social.?security/i, /birth.?cert/i, /\bvisa\b/i,
  /\bimmigration\b/i, /\bI-20\b/i, /driver.?s?.?licen/i, /\bstate.?id\b/i,
  /\bmedical\b/i, /\binsurance\b/i, /\bHIPAA\b/i, /\bdiagnosis\b/i,
  /\bprescription\b/i, /\bhealth\b/i,
];

export function isRestrictedFile(nameOrPath: string): boolean {
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(nameOrPath));
}

export const EXCLUDED_SUBJECT_KEYWORDS = [
  'tax return',
  'bank statement',
  'credit score',
  'payment due',
  'account balance',
  'routing number',
  'direct deposit',
  'wire transfer',
  'social security',
  '1099',
  'w-2',
  '1040',
  'your statement',
  'account summary',
  'minimum payment',
  'credit limit',
  'loan offer',
  'pre-approved',
];
