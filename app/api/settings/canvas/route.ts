import { NextRequest, NextResponse } from 'next/server';

// Canvas credentials are managed via environment variables.
// This endpoint is a placeholder for runtime configuration if needed.
export async function POST(req: NextRequest) {
  const { token, baseUrl } = await req.json();

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  // In production, you'd persist these to a config store or env.
  // For now, inform the user to add them to .env.local
  return NextResponse.json({
    success: true,
    message: 'Add CANVAS_API_TOKEN and CANVAS_BASE_URL to your .env.local file.',
    token: token ? '[provided]' : '[missing]',
    baseUrl: baseUrl ?? 'https://bcourses.berkeley.edu',
  });
}
