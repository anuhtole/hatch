import { NextResponse } from 'next/server';

export async function GET() {
  const expiresAt = process.env.CANVAS_TOKEN_EXPIRES ?? null;

  if (!expiresAt) {
    return NextResponse.json({ status: 'unknown', expiresAt: null, daysRemaining: null });
  }

  const expiry = new Date(expiresAt);
  const now = new Date();
  const msRemaining = expiry.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

  let status: 'valid' | 'warning' | 'urgent' | 'expired';
  if (daysRemaining < 0) {
    status = 'expired';
  } else if (daysRemaining < 10) {
    status = 'urgent';
  } else if (daysRemaining < 30) {
    status = 'warning';
  } else {
    status = 'valid';
  }

  return NextResponse.json({ status, expiresAt, daysRemaining });
}
