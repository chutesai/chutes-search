import axios from 'axios';

type DesearchSearchResult = {
  title?: string;
  url?: string;
  link?: string;
  description?: string;
  content?: string;
  snippet?: string;
  imageUrl?: string;
  image?: string;
  thumbnail?: string;
};

type DesearchApiResponse = {
  data?: DesearchSearchResult[];
  results?: DesearchSearchResult[];
};

type DesearchResponse = {
  results: {
    title: string;
    url: string;
    content?: string;
    thumbnail?: string;
  }[];
  suggestions: string[];
  error?: string;
};

const DESEARCH_WEB_API_URL = 'https://api.desearch.ai/web';

// Desearch's /web endpoint is intermittently unstable: identical queries return
// wildly different result sets call-to-call (one call can be 100% relevant, the
// next ~100% off-topic YouTube). Firing a few parallel calls and merging the
// deduplicated union smooths this out — a single junk call no longer sinks the
// whole search, and it costs no extra wall-clock since the calls run concurrently.
const DESEARCH_PARALLEL_CALLS = 2;

const singleWebSearch = async (
  apiKey: string,
  query: string,
): Promise<DesearchResponse['results']> => {
  const res = await axios.get<DesearchApiResponse | DesearchSearchResult[]>(
    DESEARCH_WEB_API_URL,
    {
      params: { query },
      headers: {
        // Desearch's live API expects the raw key in Authorization, not Bearer.
        Authorization: apiKey,
        accept: 'application/json',
      },
      timeout: 15000,
    },
  );

  const rawResults = Array.isArray(res.data)
    ? res.data
    : res.data?.data || res.data?.results || [];

  return rawResults
    .map((r) => {
      const url = r.url || r.link;
      if (!url || !r.title) return null;
      return {
        title: r.title,
        url,
        content: r.description || r.content || r.snippet,
        thumbnail: r.imageUrl || r.image || r.thumbnail,
      };
    })
    .filter(Boolean) as DesearchResponse['results'];
};

export const searchDesearch = async (
  query: string,
): Promise<DesearchResponse> => {
  const apiKey = process.env.DESEARCH_API_KEY;
  if (!apiKey) {
    const error = '[desearch] DESEARCH_API_KEY not set';
    console.warn(`${error}; returning empty results`);
    return { results: [], suggestions: [], error };
  }

  const settled = await Promise.allSettled(
    Array.from({ length: DESEARCH_PARALLEL_CALLS }, () =>
      singleWebSearch(apiKey, query),
    ),
  );

  // Merge the union of all successful calls, deduped by URL (first occurrence
  // wins — earlier calls keep their ordering).
  const seen = new Set<string>();
  const results: DesearchResponse['results'] = [];
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const r of outcome.value) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      results.push(r);
    }
  }

  if (results.length > 0) {
    return { results, suggestions: [] };
  }

  // Every call failed (or all returned nothing) — surface the first error.
  const firstError = settled.find(
    (o): o is PromiseRejectedResult => o.status === 'rejected',
  )?.reason;
  if (firstError) {
    const status = firstError?.response?.status;
    const message =
      firstError?.response?.data?.error ||
      firstError?.response?.data?.message ||
      firstError?.message ||
      'Desearch request failed';
    console.error('[desearch] request failed', status, message);
    return {
      results: [],
      suggestions: [],
      error: `[desearch] ${message}${status ? ` (status ${status})` : ''}`,
    };
  }

  return { results: [], suggestions: [] };
};
