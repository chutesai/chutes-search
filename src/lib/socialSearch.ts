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

// Per-provider timeouts (ms). Social runs concurrently with the web search, so
// the worst-case added latency is the largest of these — kept short on purpose.
const X_TIMEOUT_MS = 6000;
const REDDIT_MACROCOSMOS_TIMEOUT_MS = 9000;
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
    const done = (err: Error | null, val?: any) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {
        /* ignore */
      }
      err ? reject(err) : resolve(val);
    };

    client.on('error', (e) => done(e));
    client.setTimeout(timeoutMs, () => done(new Error(`timeout ${timeoutMs}ms`)));

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

  // SN13's miner network reliably handles only a couple of text terms — 3+ text
  // keywords frequently returns a 464 from the network — so cap to the 2 most
  // significant terms. The first keyword is the subreddit; "all" => cross-subreddit
  // search; remaining keywords are text matches (keyword_mode "any" keeps recall
  // up; we relevance-filter the union afterwards).
  const terms = significantTerms(query).slice(0, 2);
  const keywords = ['all', ...terms];
  const body = JSON.stringify({
    source: 'Reddit',
    keywords,
    limit: 25,
    keyword_mode: 'any',
  });

  // SN13 is a live decentralized network — occasional 504/transient errors are
  // normal — so try twice before giving up.
  let res: { data?: any[] } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      res = await http2JsonPost(
        MACROCOSMOS_SN13_ORIGIN,
        MACROCOSMOS_SN13_PATH,
        { authorization: `Bearer ${apiKey}` },
        body,
        REDDIT_MACROCOSMOS_TIMEOUT_MS,
      );
      break;
    } catch (err) {
      if (attempt === 1) throw err;
    }
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

  const [xPosts, redditMc, redditDs] = await Promise.all([
    safe('x/desearch', () => xFn(query)),
    safe('reddit/macrocosmos', () => redditMcFn(query)),
    safe('reddit/desearch', () => redditDsFn(query)),
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
