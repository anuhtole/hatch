import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildArtifactPayload } from '@/lib/resume/last-green';

type Params = { params: Promise<{ id: string }> };

// Map the persisted EmailDraft.status ("draft" | "sent" | "discarded") onto the
// client-side DraftSegment.status union the chat surface renders.
function mapDraftStatus(status: string): 'pending' | 'sent' | 'discarded' {
  if (status === 'sent') return 'sent';
  if (status === 'discarded') return 'discarded';
  return 'pending'; // "draft" → still actionable
}

// GET /api/conversations/[id]/messages
//
// Normalizes Prisma rows into the client-side ChatMessage shape the chat
// surface and history-replay path both expect: { id, role, segments[],
// loading }. Without this transform, the client crashes on every loaded
// conversation — MessageBubble calls msg.segments.filter() and
// sendMessage maps over m.segments to build the history payload.
//
// Messages linked to an EmailDraft (emailDraftId) get an extra `draft`
// segment carrying the draft's CURRENT status, so a sent / pending /
// discarded email card is rehydrated at the right point in the chat
// instead of vanishing on reload.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const rows = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  });

  // Batch-fetch the linked drafts in one query (avoids N+1).
  const draftIds = rows.map((r) => r.emailDraftId).filter((d): d is string => !!d);
  const drafts = draftIds.length
    ? await prisma.emailDraft.findMany({ where: { id: { in: draftIds } } })
    : [];
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const messages = rows.map((r) => {
    const segments: Array<Record<string, unknown>> = [
      { type: 'text', content: r.content ?? '' },
    ];

    if (r.emailDraftId) {
      const draft = draftById.get(r.emailDraftId);
      if (draft) {
        let attachmentNames: string[] = [];
        if (draft.attachments) {
          try {
            const parsed = JSON.parse(draft.attachments);
            if (Array.isArray(parsed)) {
              attachmentNames = parsed.map((a) => a?.filename).filter(Boolean);
            }
          } catch { /* ignore malformed attachment json */ }
        }
        segments.push({
          type: 'draft',
          id: draft.id,
          to: draft.to, // JSON-array string; DraftInlineCard parses it
          subject: draft.subject,
          body: draft.body,
          attachments: attachmentNames,
          status: mapDraftStatus(draft.status),
          sentAt: draft.sentAt ? draft.sentAt.toISOString() : null,
          fromHistory: true,
        });
      }
    }

    // B-13: rebuild the verified-artifact card from artifactTarget. The payload
    // is constructed fresh on every load via buildArtifactPayload → loadLastGreen,
    // so hashes are RE-VERIFIED server-side each time the conversation renders.
    // If verification fails (stale/tampered/regenerated artifacts), the card is
    // replaced by a visible note rather than silently serving old links.
    if (r.artifactTarget) {
      try {
        const payload = buildArtifactPayload(r.artifactTarget);
        segments.push({ type: 'artifact', ...payload, fromHistory: true });
      } catch (err) {
        segments.push({
          type: 'text',
          content: `\n\n_[artifact card for "${r.artifactTarget}" unavailable: ${err instanceof Error ? err.message : String(err)}]_`,
        });
      }
    }

    return {
      id:       r.id,
      role:     r.role,
      segments,
      loading:  false,
    };
  });

  return NextResponse.json({ messages });
}
