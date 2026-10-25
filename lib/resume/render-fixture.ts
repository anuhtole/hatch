/**
 * lib/resume/render-fixture.ts
 *
 * Manual fixture for the Phase-2 .docx renderer. Builds a representative
 * ResumeDoc that exercises EVERY canonical element, renders it via
 * renderResumeDocx, and writes the result to ~/hatch/out/fixture-resume.docx.
 *
 * Run with:  npx tsx lib/resume/render-fixture.ts
 *
 * The data here is placeholder/sample (NOT generated from the vault) — Phase 2
 * is render-only. Tailoring/generation is a later phase.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { renderResumeDocx, type ResumeDoc } from '@/lib/resume/render-docx';

const fixture: ResumeDoc = {
  header: {
    name: 'Anatole Palmer Seychal',
    // Joined with " | " on one centered line by the renderer.
    contact: ['Berkeley, CA', '(000) 000-0000', 'you@example.com', 'linkedin.com/in/you'],
  },
  education: [
    {
      school: 'University of California, Berkeley',
      right: 'Expected Graduation: May 2027',
      degrees: 'B.A. Applied Mathematics, B.A. Data Science, B.A. Political Economy',
      coursework: 'Data Structures, Probability & Statistics, Numerical Analysis, Machine Learning',
    },
  ],
  experience: [
    {
      company: 'Microsoft',
      location: 'Redmond, WA',
      role: 'Product Manager Intern',
      dates: 'Summer 2025',
      bullets: [
        'Conceived, developed, and owned an AI Reviewer Agent for Power Apps, increasing review efficiency 35%.',
        'Designed the entire UI/UX for the MVP and led cross-functional rollout with engineering and design.',
        'Presented the experience review to C-suite and product SVPs, securing executive buy-in.',
      ],
    },
    {
      company: 'Pitchbook',
      location: 'San Francisco, CA',
      role: 'Project Manager',
      dates: 'Spring 2025',
      bullets: [
        'Directed a 6-consultant team through a 10-week product engagement.',
        'Had 3 of 4 product proposals approved by the VP of Product.',
      ],
    },
  ],
  projects: [
    {
      company: 'AutoMate – AI Vehicle Buying Assistant',
      location: 'Berkeley, CA',
      role: 'Software Engineer & Product Manager',
      dates: 'Mar–Jun 2024',
      bullets: [
        'Built an AI vehicle-buying platform with a fine-tuned LLM and an end-to-end data pipeline.',
        'Managed the full product lifecycle from idea to working prototype.',
      ],
    },
  ],
  additional: {
    skillsAndLanguages:
      'SQL, Python, Java, TensorFlow, Power BI, Git, AWS, Azure; English (fluent), Spanish (advanced)',
    interests: 'Soccer, Poker, Health & Wellness, Crypto, AI, Philosophy, Math',
  },
};

async function main() {
  const buf = await renderResumeDocx(fixture);
  const outDir = join(homedir(), 'hatch', 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'fixture-resume.docx');
  writeFileSync(outPath, buf);
  console.log(`[render-fixture] wrote ${buf.length} bytes → ${outPath}`);
}

main().catch((err) => {
  console.error('[render-fixture] failed:', err);
  process.exit(1);
});
