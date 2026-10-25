import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const { account } = await req.json();

  if (!account) {
    return NextResponse.json({ error: 'account is required' }, { status: 400 });
  }

  await prisma.account.deleteMany({ where: { label: account } });

  return NextResponse.json({ success: true });
}
