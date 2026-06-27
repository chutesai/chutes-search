import axios from 'axios';
import http2 from 'node:http2';

/**
 * Social-media search for Chutes Search.
 *
 * Pulls supplementary, LOW-TRUST signal from X (Twitter) and Reddit and hands it
 * to the answering LLM clearly framed as unverified, unmoderated personal opinion
 * — never as authoritative fact (see `buildSocialContext`). Providers:
 *
 *  - **X / Twitter** — Bittensor SN22 (Desearch) `GET /twitter`. Real-time tweet
 *    search; the same provider already used for web search.
 *  - **Reddit (primary)** — Bittensor SN13 (Macrocosmos / Data Universe)
 *    `OnDemandData`. Fast, reliable, and behaves like a searchable Reddit archive
 *    (slightly less up-to-the-minute than a live scrape). This is the steer Jon
 *    gave: "use their reddit stuff … a good team, giving them a nod isn't bad".
 *  - **Reddit (best-effort)** — SN22 (Desearch) `/desearch/ai/search` with the
 *    `reddit` tool. Higher quality but slow (often 30s+), so it runs with a tight
 *    timeout and simply contributes nothing when it doesn't return in time; SN13
 *    carries Reddit on its own.
 *
 * All calls run concurrently with their own timeouts so social search can never
 * meaningfully delay the answer. Results are deliberately capped small so the
 * noisy social content can't drown out the authoritative web sources.
 */

export type SocialPost = {
  platform: 'x' | 'reddit';
  author: string;
  community?: string; // subreddit, e.g. "r/MachineLearning"
  title?: string; // reddit post title
  text: string;
  url: string;
  engagement?: string; // human-readable, e.g. "1.2k likes · 340 reposts"
  date?: string;
  provider: 'desearch-sn22' | 'macrocosmos-sn13';
};

export type SocialSearchResult = {
  tweets: SocialPost[];
  reddit: SocialPost[];
  errors: string[];
};

export type SocialSearchOverrides = {
  searchXFn?: (query: string) => Promise<SocialPost[]>;
  searchRedditMacrocosmosFn?: (query: string) => Promise<SocialPost[]>;
  searchRedditDesearchFn?: (query: string) => Promise<SocialPost[]>;
};

const DESEARCH_TWITTER_URL = 'https://api.desearch.ai/twitter';
const DESEARCH_AI_SEARCH_URL = 'https://api.desearch.ai/desearch/ai/search';
const MACROCOSMOS_SN13_ORIGIN = 'https://constellation.api.cloud.macrocosmos.ai';
const MACROCOSMOS_SN13_PATH = '/sn13.v1.Sn13Service/OnDemandData';

// Keep social a small, clearly-secondary slice of the context.
const MAX_TWEETS = 4;
const MAX_REDDIT = 4;

// Per-provider timeouts (ms). Social runs concurrently with the web search and is
// awaited before the answer is generated, so these are HARD caps on how much
// social search can add to the user's wait — kept short on purpose. SN13 often
// takes 10s+ to respond; we'd rather skip Reddit than make every answer that slow.
const X_TIMEOUT_MS = 6000;
// SN13's miner network latency swings widely by time of day (~3s off-peak, 8-14s
// at busy times). This is a total budget across candidate-subreddit attempts and
// overlaps the whole retriever (LLM rewrite + web search), so most of it is
// hidden; when SN13 is slower than this, Reddit is simply skipped (best-effort).
const REDDIT_MACROCOSMOS_TIMEOUT_MS = 8000;
const REDDIT_DESEARCH_TIMEOUT_MS = 6000;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'of', 'to', 'in', 'on', 'for', 'with', 'about', 'what', 'whats',
  'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'do', 'did',
  'can', 'could', 'would', 'should', 'will', 'going', 'into', 'from', 'that',
  'this', 'these', 'those', 'there', 'here', 'between', 'latest', 'current',
  'status', 'update', 'news', 'best', 'top', 'people', 'opinion', 'opinions',
  'think', 'reddit', 'twitter', 'tweet', 'tweets',
]);

const significantTerms = (query: string): string[] =>
  Array.from(
    new Set(
      (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (w) => !STOP_WORDS.has(w),
      ),
    ),
  );

// Drop posts that don't mention any meaningful query term. Social search is not
// reranked downstream (it's appended after the web sources), so this client-side
// relevance gate is what keeps off-topic chatter out. If the query has no
// significant terms we can't judge, so we keep everything.
const filterRelevant = (
  posts: SocialPost[],
  terms: string[],
): SocialPost[] => {
  if (terms.length === 0) return posts;
  return posts.filter((p) => {
    const hay =
      `${p.title ?? ''} ${p.text ?? ''} ${p.community ?? ''}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
};

const compactNumber = (n: unknown): string | null => {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(v);
};

// --- X / Twitter via Desearch (SN22) ------------------------------------------

const searchXDesearch = async (query: string): Promise<SocialPost[]> => {
  const apiKey = process.env.DESEARCH_API_KEY;
  if (!apiKey) return [];

  const res = await axios.get<any[]>(DESEARCH_TWITTER_URL, {
    params: { query, count: 10 },
    // Desearch's live API expects the raw key in Authorization, not Bearer.
    headers: { Authorization: apiKey, accept: 'application/json' },
    timeout: X_TIMEOUT_MS,
  });

  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .map((t): SocialPost | null => {
      const text = (t?.text ?? '').toString().trim();
      const url = t?.url || (t?.id ? `https://x.com/i/status/${t.id}` : '');
      if (!text || !url) return null;
      const handle = t?.user?.username
        ? `@${String(t.user.username).replace(/^@/, '')}`
        : (t?.user?.name ?? 'unknown');
      const engagement = [
        compactNumber(t?.like_count) && `${compactNumber(t.like_count)} likes`,
        compactNumber(t?.retweet_count) &&
          `${compactNumber(t.retweet_count)} reposts`,
        compactNumber(t?.view_count) && `${compactNumber(t.view_count)} views`,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        platform: 'x',
        author: handle,
        text,
        url,
        engagement: engagement || undefined,
        date: t?.created_at || undefined,
        provider: 'desearch-sn22',
      };
    })
    .filter((p): p is SocialPost => p !== null);
};

// The Constellation (Connect-RPC) gateway only speaks HTTP/2 — over HTTP/1.1 it
// returns a bare `464`, and Node's axios/fetch are HTTP/1.1 — so we hit it with
// the native http2 client. Single unary JSON POST; resolves the parsed body.
const http2JsonPost = (
  origin: string,
  path: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<any> =>
  new Promise((resolve, reject) => {
    const client = http2.connect(origin);
    let settled = false;
    // Hard deadline: http2session.setTimeout is only an INACTIVITY timeout, so a
    // slow-but-streaming response (the SN13 miner net regularly takes 10s+) never
    // trips it. Use an explicit timer that destroys the connection so social
    // search can't blow past its latency budget.
    const deadline = setTimeout(
      () => done(new Error(`timeout ${timeoutMs}ms`)),
      timeoutMs,
    );
    const done = (err: Error | null, val?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        client.destroy();
      } catch {
        /* ignore */
      }
      err ? reject(err) : resolve(val);
    };

    client.on('error', (e) => done(e));

    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...headers,
    });
    let status = 0;
    let data = '';
    req.on('response', (h) => {
      status = Number(h[':status']) || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (d) => (data += d));
    req.on('error', (e) => done(e));
    req.on('end', () => {
      if (status < 200 || status >= 300) {
        return done(new Error(`status ${status}`));
      }
      try {
        done(null, JSON.parse(data));
      } catch {
        done(new Error('invalid JSON response'));
      }
    });
    req.end(body);
  });

// --- Reddit via Macrocosmos SN13 (Data Universe) ------------------------------

const searchRedditMacrocosmos = async (
  query: string,
): Promise<SocialPost[]> => {
  const apiKey = process.env.MACROCOSMOS_API_KEY;
  if (!apiKey) return [];

  // SN13's OnDemand API is effectively a SUBREDDIT feed fetcher, not a text
  // search: keywords[0] is the subreddit and only a real subreddit returns
  // anything. `r/all` cross-subreddit "search" ignores the text keywords (returns
  // unrelated recent posts), and multi-keyword text matching returns empty. So we
  // treat the query's most significant terms as candidate subreddit names
  // (nvidia -> r/nvidia, bitcoin -> r/Bitcoin, ...) and fetch the first one that
  // resolves. Topical posts come back inherently on-topic; the relevance filter
  // downstream trims any stragglers. Topics with no matching subreddit simply
  // yield no Reddit posts — fine for a low-trust, best-effort source.
  const candidates = significantTerms(query).slice(0, 3);
  if (candidates.length === 0) return [];

  // Shared total budget across all candidate attempts so a slow/empty subreddit
  // can't stack into a multi-second stall (each attempt's timeout is the
  // remaining budget, and http2JsonPost enforces it as a hard deadline).
  const deadline = Date.now() + REDDIT_MACROCOSMOS_TIMEOUT_MS;
  let res: { data?: any[] } | null = null;
  let lastErr: unknown;
  for (const subreddit of candidates) {
    const remaining = deadline - Date.now();
    if (remaining < 800) break; // not enough budget left to bother
    const body = JSON.stringify({
      source: 'Reddit',
      keywords: [subreddit],
      limit: 25,
      keyword_mode: 'all',
    });
    try {
      const attempt = await http2JsonPost(
        MACROCOSMOS_SN13_ORIGIN,
        MACROCOSMOS_SN13_PATH,
        { authorization: `Bearer ${apiKey}` },
        body,
        remaining,
      );
      if (Array.isArray(attempt?.data) && attempt.data.length > 0) {
        res = attempt;
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (!res) {
    if (lastErr) throw lastErr;
    return []; // no candidate subreddit resolved — not an error
  }

  const rows = Array.isArray(res?.data) ? res!.data! : [];
  return rows
    .map((r): SocialPost | null => {
      const url = r?.uri;
      const text = (r?.body ?? r?.title ?? '').toString().trim();
      if (!url || !text) return null;
      const engagement = [
        compactNumber(r?.score) && `score ${compactNumber(r.score)}`,
        compactNumber(r?.num_comments) &&
          `${compactNumber(r.num_comments)} comments`,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        platform: 'reddit',
        author: r?.username ? `u/${String(r.username).replace(/^u\//, '')}` : 'unknown',
        community: r?.communityName || undefined,
        title: r?.title || undefined,
        text,
        url,
        engagement: engagement || undefined,
        date: r?.datetime || undefined,
        provider: 'macrocosmos-sn13',
      };
    })
    .filter((p): p is SocialPost => p !== null);
};

// --- Reddit via Desearch SN22 (best-effort, often times out) ------------------

const searchRedditDesearch = async (query: string): Promise<SocialPost[]> => {
  const apiKey = process.env.DESEARCH_API_KEY;
  if (!apiKey) return [];

  const res = await axios.post<{ reddit_search?: any[] }>(
    DESEARCH_AI_SEARCH_URL,
    {
      prompt: query,
      tools: ['reddit'],
      date_filter: 'PAST_MONTH',
      streaming: false,
    },
    {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      timeout: REDDIT_DESEARCH_TIMEOUT_MS,
    },
  );

  const rows = Array.isArray(res.data?.reddit_search)
    ? res.data!.reddit_search!
    : [];
  return rows
    .map((r): SocialPost | null => {
      const url = r?.link || r?.url;
      const text = (r?.snippet ?? r?.title ?? '').toString().trim();
      if (!url || !text || !/reddit\.com/i.test(String(url))) return null;
      const sub = /reddit\.com\/(r\/[^/]+)/i.exec(String(url))?.[1];
      return {
        platform: 'reddit',
        author: 'unknown',
        community: sub || undefined,
        title: r?.title || undefined,
        text,
        url,
        provider: 'desearch-sn22',
      };
    })
    .filter((p): p is SocialPost => p !== null);
};

const dedupeByUrl = (posts: SocialPost[]): SocialPost[] => {
  const seen = new Set<string>();
  const out: SocialPost[] = [];
  for (const p of posts) {
    const key = p.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
};

export const searchSocial = async (
  query: string,
  overrides?: SocialSearchOverrides,
): Promise<SocialSearchResult> => {
  const terms = significantTerms(query);
  const errors: string[] = [];

  const xFn = overrides?.searchXFn ?? searchXDesearch;
  const redditMcFn =
    overrides?.searchRedditMacrocosmosFn ?? searchRedditMacrocosmos;
  const redditDsFn =
    overrides?.searchRedditDesearchFn ?? searchRedditDesearch;

  const safe = async (
    label: string,
    fn: () => Promise<SocialPost[]>,
  ): Promise<SocialPost[]> => {
    try {
      return await fn();
    } catch (err: any) {
      const msg = err?.response?.status
        ? `${label}: status ${err.response.status}`
        : `${label}: ${err?.message || 'failed'}`;
      // Timeouts are expected (esp. desearch reddit); log quietly, never throw.
      console.warn(`[socialSearch] ${msg}`);
      errors.push(msg);
      return [];
    }
  };

  // Desearch's reddit (ai/search) is reliably too slow (30s+) to return within
  // budget, so it must NOT gate latency — it runs opportunistically and only
  // contributes if it happens to finish before the primary X + SN13 calls do.
  // SN13 (Macrocosmos) is the Reddit workhorse.
  let redditDs: SocialPost[] = [];
  const redditDsPromise = safe('reddit/desearch', () => redditDsFn(query)).then(
    (r) => {
      redditDs = r;
      return r;
    },
  );

  // Latency is driven only by the two primary providers (each hard-capped).
  const [xPosts, redditMc] = await Promise.all([
    safe('x/desearch', () => xFn(query)),
    safe('reddit/macrocosmos', () => redditMcFn(query)),
  ]);
  // Tiny grace so an already-fast desearch reddit (or a mocked one) is folded in,
  // without waiting on the common slow case.
  await Promise.race([
    redditDsPromise,
    new Promise((r) => setTimeout(r, 150)),
  ]);

  const tweets = filterRelevant(dedupeByUrl(xPosts), terms).slice(0, MAX_TWEETS);
  const reddit = filterRelevant(
    dedupeByUrl([...redditMc, ...redditDs]),
    terms,
  ).slice(0, MAX_REDDIT);

  return { tweets, reddit, errors };
};

/**
 * Render social posts as a clearly-delimited, low-trust block to append to the
 * LLM context. Each entry is numbered starting at `startIndex + 1` so it lines up
 * with `[n]` citations and the Sources list (the posts are added to `sources` in
 * the same order). The framing is deliberately strong: the model must treat these
 * as anecdotal opinion, attribute them as social media, and never present them as
 * established fact.
 */
export const SOCIAL_CONTEXT_HEADER =
  `--- SOCIAL MEDIA POSTS (UNVERIFIED — LOW TRUST) ---\n` +
  `The numbered items below are individual posts from X (Twitter) and Reddit. ` +
  `Unlike the web sources above, this is unmoderated, personal-opinion content ` +
  `and may be inaccurate, biased, satirical, promotional, or outright wrong. ` +
  `Use it only as soft, anecdotal signal — e.g. to convey public sentiment, ` +
  `rumors, or first-hand anecdotes — and ALWAYS attribute it in-text as social ` +
  `media (e.g. "a user on X" or "a Reddit poster in r/..."). Never state social ` +
  `claims as fact, and prefer the authoritative web sources above whenever they ` +
  `conflict. If a social post is the only support for a claim, flag it as ` +
  `unverified.`;

export const socialPostsToContext = (
  posts: SocialPost[],
  startIndex: number,
): string => {
  if (posts.length === 0) return '';
  const lines = posts.map((p, i) => {
    const who =
      p.platform === 'x'
        ? `X · ${p.author}`
        : `Reddit · ${p.community ? `${p.community} · ` : ''}${p.author}`;
    const meta = [p.title, p.engagement].filter(Boolean).join(' · ');
    const head = meta ? `${who} — ${meta}` : who;
    return `${startIndex + i + 1}. [social/${p.platform}] ${head}: ${p.text}`;
  });
  return `${SOCIAL_CONTEXT_HEADER}\n${lines.join('\n')}`;
};
