import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

type SaveBody = {
  identity: {
    name: string;
    email: string;
    phone: string;
    linkedin: string;
    location: string;
    status: string;
  };
  education: {
    degrees: Array<{ institution: string; expected: string; majors: string[]; notes: string }>;
    coursework: string[];
  };
  experience: Array<{ company: string; role: string; period: string; location: string; bullets: string[] }>;
  projects: Array<{ title: string; institution: string; period: string; bullets: string[] }>;
  research: Array<{ title: string; institution: string; period: string; bullets: string[] }>;
  skills: { technical: string[]; tools: string[]; languages: string[] };
  interests: string[];
  customSections?: Array<{ title: string; bullets: string[] }>;
};

function buildMarkdown(d: SaveBody): string {
  const lines: string[] = [];

  lines.push(`# ${d.identity.name} — Resume`);
  lines.push('');
  lines.push(`**Email:** ${d.identity.email} | **Phone:** ${d.identity.phone}`);
  lines.push(`**LinkedIn:** ${d.identity.linkedin} | **Location:** ${d.identity.location}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Education');
  lines.push('');
  for (const deg of d.education.degrees) {
    lines.push(`**${deg.institution}** — Expected Graduation ${deg.expected}`);
    lines.push(`- Triple Major: ${deg.majors.join(', ')}`);
    if (deg.notes) lines.push(`- ${deg.notes}`);
    if (d.education.coursework.length > 0) {
      lines.push(`- Relevant coursework: ${d.education.coursework.join(', ')}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Professional Experience');
  lines.push('');
  for (const exp of d.experience) {
    lines.push(`### ${exp.company} — ${exp.role}`);
    lines.push(`**${exp.location} | ${exp.period}**`);
    for (const b of exp.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Projects');
  lines.push('');
  for (const p of d.projects) {
    lines.push(`### ${p.title}`);
    lines.push(`**${p.institution} | ${p.period}**`);
    for (const b of p.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Research');
  lines.push('');
  for (const r of d.research) {
    lines.push(`### ${r.title}`);
    lines.push(`**${r.institution} | ${r.period}**`);
    for (const b of r.bullets) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Technical Skills');
  lines.push('');
  if (d.skills.technical.length > 0) {
    lines.push(`**Technical:** ${d.skills.technical.join(', ')}`);
    lines.push('');
  }
  if (d.skills.tools.length > 0) {
    lines.push(`**Platforms:** ${d.skills.tools.join(', ')}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Languages');
  lines.push('');
  for (const lang of d.skills.languages) lines.push(`- ${lang}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Interests');
  lines.push('');
  lines.push(d.interests.join(', '));
  lines.push('');

  if (d.customSections && d.customSections.length > 0) {
    for (const cs of d.customSections) {
      lines.push('---');
      lines.push('');
      lines.push(`## ${cs.title}`);
      lines.push('');
      for (const b of cs.bullets) lines.push(`- ${b}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const body: SaveBody = await req.json();
    const md = buildMarkdown(body);

    const resumePath = join(process.cwd(), 'wiki', 'raw', 'resume-anatole-seychal.md');
    writeFileSync(resumePath, md, 'utf-8');

    // Upsert KnowledgeDocument
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { sourceId: 'manual-resume-anatole-seychal' },
      select: { id: true },
    });

    if (existing) {
      await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: { content: md, lastSyncedAt: new Date() },
      });
    } else {
      await prisma.knowledgeDocument.create({
        data: {
          sourceId: 'manual-resume-anatole-seychal',
          title: `${body.identity.name} — Resume`,
          content: md,
          source: 'manual',
          category: 'person',
          lastSyncedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('save-resume error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
