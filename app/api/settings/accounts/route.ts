import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const accounts = await prisma.account.findMany({
    select: {
      label: true,
      email: true,
      tokenExpiry: true,
    },
  });

  return NextResponse.json({ accounts });
}
