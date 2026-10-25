import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ROUTES } from '@/lib/models';
import { prisma } from '@/lib/prisma';
import { categorizeContact, subcategorizeContact } from '@/lib/network-categorizer';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface EnrichmentResult {
  company?: string;
  position?: string;
  school?: string;
  major?: string;
  linkedinUrl?: string;
}

async function enrichContact(
  firstName: string,
  lastName: string,
  currentCompany?: string | null,
  currentPosition?: string | null,
): Promise<EnrichmentResult> {
  const query = `${firstName} ${lastName}${currentCompany ? ` ${currentCompany}` : ''}${currentPosition ? ` ${currentPosition}` : ''}`;

  const msg = await anthropic.messages.create({
    model: ROUTES.APP_DEFAULT,
    max_tokens: 500,
    tools: [
      {
        name: 'web_search',
        type: 'web_search_20250305' as 'web_search_20250305',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Search for professional information about "${query}".
Return a JSON object with these fields (use null if not found):
{
  "company": "current employer name",
  "position": "current job title",
  "school": "undergraduate university",
  "major": "undergraduate major or field of study",
  "linkedinUrl": "linkedin.com/in/... URL if found"
}
Only return the JSON object, nothing else.`,
      },
    ],
  });

  // Extract text from the final response
  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return {};

  try {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]) as EnrichmentResult;
    return {
      company: parsed.company ?? undefined,
      position: parsed.position ?? undefined,
      school: parsed.school ?? undefined,
      major: parsed.major ?? undefined,
      linkedinUrl: parsed.linkedinUrl ?? undefined,
    };
  } catch {
    return {};
  }
}

// POST /api/network/enrich
// Body: { contactId?: string } — if omitted, picks next unenriched contact
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { contactId?: string };

    let contact;
    if (body.contactId) {
      contact = await prisma.contactEntry.findUnique({ where: { id: body.contactId } });
    } else {
      contact = await prisma.contactEntry.findFirst({
        where: { enrichedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!contact) {
      return NextResponse.json({ done: true, message: 'All contacts enriched' });
    }

    const total = await prisma.contactEntry.count();
    const remaining = await prisma.contactEntry.count({ where: { enrichedAt: null } });
    const enriched = total - remaining;

    const result = await enrichContact(
      contact.firstName,
      contact.lastName,
      contact.company,
      contact.position,
    );

    // Merge enrichment into existing data — prefer enriched over original
    const updatedCompany = result.company ?? contact.company ?? undefined;
    const updatedPosition = result.position ?? contact.position ?? undefined;
    const { tier, category } = categorizeContact({
      company: updatedCompany,
      position: updatedPosition,
      school: result.school ?? contact.school,
    });
    const subcategory = subcategorizeContact(updatedPosition);

    const updated = await prisma.contactEntry.update({
      where: { id: contact.id },
      data: {
        company: updatedCompany,
        position: updatedPosition,
        school: result.school ?? contact.school ?? undefined,
        major: result.major ?? contact.major ?? undefined,
        linkedinUrl: result.linkedinUrl ?? contact.linkedinUrl ?? undefined,
        tier,
        category,
        subcategory,
        enrichedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      contactId: updated.id,
      name: `${updated.firstName} ${updated.lastName}`,
      enriched: enriched + 1,
      total,
      remaining: remaining - 1,
    });
  } catch (err) {
    console.error('network/enrich error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
