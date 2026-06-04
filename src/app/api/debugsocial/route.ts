import { NextRequest } from 'next/server';
import { searchSocial } from '@/lib/socialSearch';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || 'nvidia gpu shortage';
  const t0 = Date.now();
  const res = await searchSocial(q);
  return Response.json({
    q,
    ms: Date.now() - t0,
    hasMacrocosmosKey: !!process.env.MACROCOSMOS_API_KEY,
    hasDesearchKey: !!process.env.DESEARCH_API_KEY,
    tweets: res.tweets.length,
    reddit: res.reddit.length,
    errors: res.errors,
  });
}
