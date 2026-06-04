import { searchSearxng } from '../searxng';
import { searchDesearch } from '../desearch';
import { searchSerper, searchSerperVideos } from '../serper';

type UnifiedResult = {
  title: string;
  url: string;
  content?: string;
  thumbnail?: string;
};

export type SearchEngine = 'searxng' | 'desearch' | 'serper';

export type SearchRunResult = {
  engine: SearchEngine;
  results: UnifiedResult[];
  suggestions: string[];
  error?: string;
};

type SearchOverrides = {
  searchDesearchFn?: typeof searchDesearch;
  searchSearxngFn?: typeof searchSearxng;
  searchSerperFn?: typeof searchSerper;
  searchSerperVideosFn?: typeof searchSerperVideos;
};

// A provider must return at least this many results that look relevant to the
// query before we trust it. Desearch (the preferred provider) intermittently
// returns a whole page of unrelated results (e.g. random YouTube videos matching
// a single stop-word); when that happens, relevantCount drops to ~0 and we fall
// through to Serper instead of showing junk. We do NOT hard-drop YouTube here —
// relevant videos are valuable — the always-on embedding reranker downstream is
// what scans every result for topical relevance.
const MIN_RELEVANT_RESULTS = 3;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
  'been', 'of', 'to', 'in', 'on', 'for', 'with', 'about', 'what', 'whats',
  'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'do', 'did',
  'can', 'could', 'would', 'should', 'will', 'going', 'into', 'from', 'that',
  'this', 'these', 'those', 'there', 'here', 'between', 'latest', 'current',
  'status', 'update', 'news', 'best', 'top',
]);

const significantTerms = (query: string): string[] =>
  Array.from(
    new Set(
      (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (w) => !STOP_WORDS.has(w),
      ),
    ),
  );

// How many of the results actually mention a meaningful query term. If the query
// has no significant terms (e.g. a single stop-word), we can't judge, so trust
// the provider's own count.
const countRelevant = (results: UnifiedResult[], terms: string[]): number => {
  if (terms.length === 0) return results.length;
  return results.filter((r) => {
    const hay = `${r.title ?? ''} ${r.content ?? ''}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  }).length;
};

const normalizeSearxngResults = (results: any[]): UnifiedResult[] =>
  results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    thumbnail: r.thumbnail || r.thumbnail_src || r.img_src,
  }));

export const runWebSearch = async (
  query: string,
  activeEngines: string[] = [],
  overrides?: SearchOverrides,
): Promise<SearchRunResult> => {
  const startTime = Date.now();
  const log = (msg: string) =>
    console.log(
      `[webSearch] ${new Date().toISOString()} | +${Date.now() - startTime}ms | ${msg}`,
    );

  log(`Starting web search (queryLen=${query.length})`);

  const searxngSearch = overrides?.searchSearxngFn ?? searchSearxng;
  const desearchSearch = overrides?.searchDesearchFn ?? searchDesearch;
  const serperSearch = overrides?.searchSerperFn ?? searchSerper;
  const serperVideosSearch =
    overrides?.searchSerperVideosFn ?? searchSerperVideos;

  // Video-oriented focus modes (youtubeSearch): use Serper's video search, which
  // returns dependable on-topic YouTube results. Desearch has no video-specific
  // mode and the SearxNG youtube engine instance is down.
  const wantsVideo = activeEngines.some((e) =>
    ['youtube', 'video', 'vimeo', 'dailymotion'].includes(e.toLowerCase()),
  );
  if (wantsVideo) {
    log('Video focus — trying Serper videos...');
    const videoRes = await serperVideosSearch(query);
    const videoResults = Array.isArray(videoRes?.results)
      ? videoRes.results
      : [];
    log(`Serper videos returned ${videoResults.length} results`);
    if (videoResults.length > 0) {
      return { engine: 'serper', results: videoResults, suggestions: [] };
    }
    // else fall through to the normal web flow below.
  }

  const terms = significantTerms(query);
  let suggestions: string[] = [];

  // 1) Desearch (Bittensor SN22) — the PREFERRED web provider. Tried first so the
  // common path is a single fast call (the previously-primary SearxNG instance is
  // down and its connect-timeout added ~8s of dead latency to every query). Trust
  // Desearch only when enough of its results look relevant to the query.
  log('Trying Desearch...');
  const desearchRes = await desearchSearch(query);
  const desearchResults = Array.isArray(desearchRes?.results)
    ? desearchRes.results
    : [];
  const desearchRelevant = countRelevant(desearchResults, terms);
  log(
    `Desearch returned ${desearchResults.length} results (${desearchRelevant} relevant to query)`,
  );
  suggestions = [...new Set([...(desearchRes?.suggestions ?? [])])];

  if (desearchRelevant >= MIN_RELEVANT_RESULTS) {
    log(`Using Desearch results (${desearchResults.length})`);
    return { engine: 'desearch', results: desearchResults, suggestions };
  }

  // 2) Serper (reliable Google) — quality backstop when Desearch returned mostly
  // off-topic results (its known intermittent failure mode).
  log('Falling back to Serper...');
  const serperRes = await serperSearch(query);
  const serperResults = Array.isArray(serperRes?.results)
    ? serperRes.results
    : [];
  log(`Serper returned ${serperResults.length} results`);

  if (serperResults.length > 0) {
    return {
      engine: 'serper',
      results: serperResults,
      suggestions: [
        ...new Set([...suggestions, ...(serperRes?.suggestions ?? [])]),
      ],
    };
  }

  // 3) SearxNG — last resort only (its configured instance is currently down, so
  // this almost never contributes; kept so a future working instance is still used).
  let searxError: string | undefined;
  try {
    log('Falling back to SearxNG (last resort)...');
    const searxngRes = await searxngSearch(query, {
      engines: activeEngines.length > 0 ? activeEngines : undefined,
    });
    const searxResults = normalizeSearxngResults(searxngRes?.results ?? []);
    log(`SearxNG returned ${searxResults.length} results`);
    if (searxResults.length > 0) {
      return {
        engine: 'searxng',
        results: searxResults,
        suggestions: [
          ...new Set([...suggestions, ...(searxngRes?.suggestions ?? [])]),
        ],
      };
    }
  } catch (err: any) {
    log(`SearxNG failed: ${err?.message ?? 'unknown error'}`);
    searxError =
      err?.response?.status === 429
        ? 'SearxNG rate limited this request.'
        : err?.message ?? 'SearxNG search failed.';
  }

  // Nothing better available — return whatever Desearch gave (the downstream
  // reranker still filters off-topic results) and surface the most relevant error.
  const error = desearchRes?.error || serperRes?.error || searxError;
  log(`Web search complete, returning ${desearchResults.length} results`);
  return {
    engine: 'desearch',
    results: desearchResults,
    suggestions,
    ...(error ? { error } : {}),
  };
};
