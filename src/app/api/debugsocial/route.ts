import { NextRequest } from 'next/server';
import { searchSocial } from '@/lib/socialSearch';
import { runWebSearch } from '@/lib/search/runWebSearch';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || 'nvidia gpu shortage';
  const mode = req.nextUrl.searchParams.get('mode') || 'concurrent';
  const t0 = Date.now();

  if (mode === 'solo') {
    const res = await searchSocial(q);
    return Response.json({ mode, q, ms: Date.now() - t0, tweets: res.tweets.length, reddit: res.reddit.length, errors: res.errors });
  }

  // Replicate the real pipeline: fire social, then await web search, then await social.
  const socialPromise = searchSocial(q);
  const web = await runWebSearch(q, []);
  const tWeb = Date.now() - t0;
  const social = await socialPromise;
  return Response.json({
    mode, q, msTotal: Date.now() - t0, msWeb: tWeb,
    webResults: web.results.length, webEngine: web.engine,
    tweets: social.tweets.length, reddit: social.reddit.length, errors: social.errors,
  });
}
