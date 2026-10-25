import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const draft = await prisma.emailDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(draft);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const allowed = ['to', 'cc', 'bcc', 'subject', 'body', 'attachments'];
  const data: Record<string, string | null> = {};
  for (const key of allowed) {
    if (key in body) {
      const val = body[key];
      // to/cc/bcc/attachments are stored as JSON strings
      if (['to', 'cc', 'bcc', 'attachments'].includes(key)) {
        data[key] = Array.isArray(val) ? JSON.stringify(val) : (val === null ? null : val);
      } else {
        data[key] = val;
      }
    }
  }
  const draft = await prisma.emailDraft.update({ where: { id }, data });
  return NextResponse.json(draft);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.emailDraft.update({
    where: { id },
    data: { status: 'discarded' },
  });
  return NextResponse.json({ ok: true });
}
