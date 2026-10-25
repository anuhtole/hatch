/**
 * app/api/knowledge/ingest/route.ts
 *
 * POST {
 *   id: string,           // KnowledgeDocument id (created by upload route)
 *   title: string,
 *   content: string,      // (possibly user-edited) extracted text
 *   summary: string,
 *   tags: string[],
 * }
 *
 * Updates the KnowledgeDocument with final content, then writes a Markdown
 * file with YAML frontmatter into ~/vault/07-ingested/ and appends to
 * ~/vault/memory/log.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { prisma } from '@/lib/prisma';

const VAULT_PATH = process.env.VAULT_PATH || path.join(os.homedir(), 'vault');
const INGESTED_PATH = path.join(VAULT_PATH, '07-ingested');
const LOG_PATH = path.join(VAULT_PATH, 'memory', 'log.md');

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function POST(req: NextRequest) {
  try {
    const { id, title, content, summary, tags } = (await req.json()) as {
      id: string;
      title: string;
      content: string;
      summary: string;
      tags: string[];
    };

    if (!id || !content) {
      return NextResponse.json({ error: 'id and content are required' }, { status: 400 });
    }

    // Update KnowledgeDocument
    const doc = await prisma.knowledgeDocument.update({
      where: { id },
      data: {
        title,
        content,
        summary,
        lastSyncedAt: new Date(),
      },
    });

    // Write to Obsidian vault
    if (!existsSync(INGESTED_PATH)) {
      await mkdir(INGESTED_PATH, { recursive: true });
    }

    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(title);
    const vaultFile = path.join(INGESTED_PATH, `${date}-${slug}.md`);

    const tagYaml = tags.length > 0 ? tags.map((t) => `  - ${t}`).join('\n') : '  []';
    const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${date}
source: chat-upload
tags:
${tagYaml}
document_id: ${id}
---

`;
    await writeFile(vaultFile, frontmatter + `## Summary\n\n${summary}\n\n## Content\n\n${content}`);

    // Append to memory log
    const logEntry = `\n- ${new Date().toISOString()} — Ingested: **${title}** (${tags.join(', ')}) → \`07-ingested/${date}-${slug}.md\``;
    await appendFile(LOG_PATH, logEntry).catch(() => {
      /* log is optional */
    });

    return NextResponse.json({ ok: true, vaultFile, docId: doc.id });
  } catch (err) {
    console.error('[knowledge/ingest]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
