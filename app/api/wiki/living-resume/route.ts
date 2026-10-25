import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/prisma';

// ── Resume parser ─────────────────────────────────────────────────────────────

function parseSection(content: string, heading: string): string {
  const re = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

function parseBullets(block: string): string[] {
  return block
    .split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

function parseExperience(content: string) {
  const section = parseSection(content, 'Professional Experience');
  const roles: Array<{
    company: string;
    role: string;
    period: string;
    location: string;
    bullets: string[];
    sources: string[];
  }> = [];

  const blocks = section.split(/\n### /).filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0];
    const metaLine = lines[1] ?? '';
    const bulletLines = lines.slice(2);

    const [company, role] = header.includes('—')
      ? header.split('—').map((s) => s.trim())
      : [header, ''];

    const metaClean = metaLine.replace(/\*\*/g, '');
    const [location = '', period = ''] = metaClean.includes('|')
      ? metaClean.split('|').map((s) => s.trim())
      : [metaClean, ''];

    roles.push({
      company: company.replace(/^### /, '').trim(),
      role: role.trim(),
      period: period.trim(),
      location: location.trim(),
      bullets: parseBullets(bulletLines.join('\n')),
      sources: ['resume'],
    });
  }
  return roles;
}

function parseProjects(content: string) {
  const section = parseSection(content, 'Projects');
  const items: Array<{
    title: string;
    institution: string;
    period: string;
    bullets: string[];
    sources: string[];
  }> = [];

  const blocks = section.split(/\n### /).filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0];
    const metaLine = lines[1] ?? '';
    const bulletLines = lines.slice(2);

    const metaClean = metaLine.replace(/\*\*/g, '');
    const [institution = '', period = ''] = metaClean.includes('|')
      ? metaClean.split('|').map((s) => s.trim())
      : [metaClean, ''];

    items.push({
      title: header.replace(/^### /, '').trim(),
      institution: institution.trim(),
      period: period.trim(),
      bullets: parseBullets(bulletLines.join('\n')),
      sources: ['resume'],
    });
  }
  return items;
}

function parseResearch(content: string) {
  const section = parseSection(content, 'Research');
  const items: Array<{
    title: string;
    institution: string;
    period: string;
    bullets: string[];
    sources: string[];
  }> = [];

  const blocks = section.split(/\n### /).filter(Boolean);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const header = lines[0];
    const metaLine = lines[1] ?? '';
    const bulletLines = lines.slice(2);

    const metaClean = metaLine.replace(/\*\*/g, '');
    const [institution = '', period = ''] = metaClean.includes('|')
      ? metaClean.split('|').map((s) => s.trim())
      : [metaClean, ''];

    items.push({
      title: header.replace(/^### /, '').trim(),
      institution: institution.trim(),
      period: period.trim(),
      bullets: parseBullets(bulletLines.join('\n')),
      sources: ['resume'],
    });
  }
  return items;
}

function parseSkills(content: string) {
  const section = parseSection(content, 'Technical Skills');
  const technical: string[] = [];
  const tools: string[] = [];

  for (const line of section.split('\n')) {
    const m = line.match(/^\*\*(.+?):\*\*\s*(.+)/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const vals = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (key.includes('platform') || key.includes('tool')) {
      tools.push(...vals);
    } else {
      technical.push(...vals);
    }
  }

  const langSection = parseSection(content, 'Languages');
  const languages = parseBullets(langSection);

  return { technical, tools, languages, sources: ['resume'] };
}

function parseInterests(content: string): string[] {
  const section = parseSection(content, 'Interests');
  const line = section.trim().split('\n')[0] ?? '';
  return line.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── GET /api/wiki/living-resume ───────────────────────────────────────────────

export async function GET() {
  const resumePath = join(process.cwd(), 'wiki', 'raw', 'resume-anatole-seychal.md');

  let resumeContent = '';
  if (existsSync(resumePath)) {
    resumeContent = readFileSync(resumePath, 'utf-8');
  } else {
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { sourceId: 'manual-resume-anatole-seychal' },
    });
    resumeContent = doc?.content ?? '';
  }

  const recentDocs = await prisma.knowledgeDocument.findMany({
    where: {
      lastSyncedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      source: { not: 'manual' },
    },
    orderBy: { lastSyncedAt: 'desc' },
    take: 20,
    select: { title: true, source: true, lastSyncedAt: true, category: true },
  });

  const recentAssignments = await prisma.assignment.findMany({
    where: {
      dueAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { dueAt: 'desc' },
    take: 10,
    select: { title: true, courseName: true, dueAt: true, submissionStatus: true },
  });

  let network: Array<{ name: string; role?: string; email?: string; company?: string; context?: string }> = [];
  const memoryPath = join(process.cwd(), 'memory.json');
  if (existsSync(memoryPath)) {
    try {
      const mem = JSON.parse(readFileSync(memoryPath, 'utf-8'));
      if (mem.contacts) {
        network = Object.entries(mem.contacts).map(([name, data]: [string, any]) => ({
          name,
          role: data.role,
          email: data.email,
          company: data.company,
          context: data.notes ?? (data.courses ? `Courses: ${data.courses.join(', ')}` : undefined),
        }));
      }
    } catch {}
  }

  const coursework = parseSection(resumeContent, 'Education')
    .match(/Relevant coursework:\s*(.+)/)?.[1]
    ?.split(',')
    .map((s) => s.trim()) ?? [];

  const recentActivity = [
    ...recentDocs.map((d) => ({
      date: d.lastSyncedAt?.toISOString() ?? new Date().toISOString(),
      type: d.source as string,
      description: `Synced: ${d.title}`,
    })),
    ...recentAssignments.map((a) => ({
      date: a.dueAt?.toISOString() ?? new Date().toISOString(),
      type: 'assignment',
      description: `${a.courseName}: ${a.title}${a.submissionStatus ? ` (${a.submissionStatus})` : ''}`,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 15);

  const compiled = {
    compiledAt: new Date().toISOString(),
    identity: {
      name: process.env.RESUME_NAME ?? 'Anatole Palmer Seychal',
      email: process.env.RESUME_EMAIL ?? 'you@example.com',
      phone: process.env.RESUME_PHONE ?? '',
      linkedin: process.env.RESUME_LINKEDIN ?? 'linkedin.com/in/anatole-seychal',
      location: process.env.RESUME_LOCATION ?? 'Berkeley, CA',
      status: 'UC Berkeley junior — Applied Mathematics, Data Science, Political Economy',
      sources: ['resume', 'wiki'],
    },
    education: {
      degrees: [
        {
          institution: 'University of California, Berkeley',
          expected: '2027',
          majors: ['B.A. Applied Mathematics', 'B.A. Data Science', 'B.A. Political Economy'],
          notes: 'Concentration: Political Economy of Artificial Intelligence. Advisor: Prof. Karras.',
          sources: ['resume'],
        },
      ],
      coursework,
      currentCourses: recentAssignments
        .map((a) => a.courseName)
        .filter((v, i, arr) => arr.indexOf(v) === i),
      sources: ['resume', 'canvas'],
    },
    experience: parseExperience(resumeContent),
    projects: parseProjects(resumeContent),
    research: parseResearch(resumeContent),
    skills: parseSkills(resumeContent),
    interests: parseInterests(resumeContent),
    network,
    recentActivity,
  };

  return NextResponse.json(compiled);
}
