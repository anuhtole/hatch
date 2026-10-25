import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type NodeType = 'owner' | 'topic' | 'concept' | 'person' | 'course' | 'project' | 'stub';

export type GraphNode = {
  id: string;
  title: string;
  type: NodeType;
  tags: string[];
  exists: boolean;
  connections: number;
  content?: string;
};

export type GraphLink = { source: string; target: string };

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function parseFrontmatter(content: string): { title: string; tags: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: '', tags: [] };
  const fm = match[1];
  const titleMatch = fm.match(/title:\s*["']?([^"'\n]+)["']?/);
  const tagsMatch = fm.match(/tags:\s*\[([^\]]+)\]/);
  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    tags: tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : [],
  };
}

function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
}

function inferType(tags: string[], title: string): NodeType {
  if (tags.includes('owner')) return 'owner';
  if (tags.some((t) => ['people', 'person', 'contact'].includes(t))) return 'person';
  if (tags.some((t) => ['course', 'class', 'academic'].includes(t))) return 'course';
  if (tags.some((t) => ['project'].includes(t))) return 'project';
  if (tags.some((t) => ['concept'].includes(t))) return 'concept';
  const lower = title.toLowerCase();
  if (['microsoft', 'pitchbook', 'nielsen', 'dialpad', 'warner', 'automate'].some((c) => lower.includes(c))) return 'project';
  if (['professor', 'prof.', 'dr.'].some((c) => lower.includes(c))) return 'person';
  if (['nwmedia', 'rhetor', 'econ', 'math', 'physics', 'data science'].some((c) => lower.includes(c))) return 'course';
  if (['ai', 'political economy', 'quantum', 'democracy', 'labor'].some((c) => lower.includes(c))) return 'concept';
  return 'topic';
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

export async function GET() {
  const topicsDir = join(process.cwd(), 'wiki', 'topics');
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  let files: string[] = [];
  if (existsSync(topicsDir)) {
    files = readdirSync(topicsDir).filter((f) => f.endsWith('.md'));
  }

  // Parse all existing topic pages
  for (const file of files) {
    const fullPath = join(topicsDir, file);
    const content = readFileSync(fullPath, 'utf-8');
    const { title, tags } = parseFrontmatter(content);
    const id = file.replace('.md', '');
    nodes.set(id, {
      id,
      title: title || id,
      type: inferType(tags, title),
      tags,
      exists: true,
      connections: 0,
      content: stripFrontmatter(content),
    });
  }

  // Extract [[WikiLink]] refs and create stub nodes for missing pages
  for (const file of files) {
    const fullPath = join(topicsDir, file);
    const content = readFileSync(fullPath, 'utf-8');
    const fileId = file.replace('.md', '');
    const linkedTitles = extractLinks(content);

    for (const linkedTitle of linkedTitles) {
      const linkedId = slugify(linkedTitle);
      if (!nodes.has(linkedId)) {
        nodes.set(linkedId, {
          id: linkedId,
          title: linkedTitle,
          type: inferType([], linkedTitle),
          tags: [],
          exists: false,
          connections: 0,
        });
      }
      links.push({ source: fileId, target: linkedId });
      nodes.get(fileId)!.connections++;
      nodes.get(linkedId)!.connections++;
    }
  }

  const nodeArray = Array.from(nodes.values());

  return NextResponse.json({
    nodes: nodeArray,
    links,
    lastCompiled: new Date().toISOString(),
    stats: {
      totalPages: files.length,
      totalConnections: links.length,
    },
  });
}
