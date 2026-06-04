import { searchSearxng } from '../searxng';
import { searchDesearch } from '../desearch';
import { searchSerper } from '../serper';

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
};

// Minimum number of relevant (non-video) results a provider must return before
// we trust it. Below this we fall through to the next provider. Desearch
// intermittently returns a full page of unrelated YouTube videos for ordinary
// web queries, which — because speed mode skips reranking — would otherwise be
// shown verbatim as the answer's "Sources".
const MIN_GOOD_RESULTS = 3;

const VIDEO_URL = /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be|m\.youtube\.com)\//i;

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

  // For non-video focus modes, drop video results: a web-search answer should
  // not be sourced from random YouTube clips. youtubeSearch keeps them because
  // 'youtube' is in its activeEngines.
  const wantsVideo = activeEngines.some((e) =>
    ['youtube', 'video', 'vimeo', 'dailymotion'].includes(e.toLowerCase()),
  );
  const dropVideos = (results: UnifiedResult[]): UnifiedResult[] =>
    wantsVideo ? results : results.filter((r) => !VIDEO_URL.test(r.url || ''));

  let suggestions: string[] = [];
  let searxError: string | undefined;

  // 1) SearxNG (primary, self-hosted/public instance).
  try {
    log('Trying SearxNG...');
    const searxngRes = await searxngSearch(query, {
      engines: activeEngines.length > 0 ? activeEngines : undefined,
    });
    log(`SearxNG returned ${searxngRes?.results?.length || 0} results`);

    suggestions = searxngRes?.suggestions ?? [];

    // SearxNG is the configured primary and returns relevant results when it's
    // up, so trust any non-video results it gives.
    const searxResults = dropVideos(
      normalizeSearxngResults(searxngRes?.results ?? []),
    );
    if (searxResults.length > 0) {
      log(`Using SearxNG results (${searxResults.length} after video filter)`);
      return { engine: 'searxng', results: searxResults, suggestions };
    }
  } catch (err: any) {
    log(`SearxNG failed: ${err?.message ?? 'unknown error'}`);
    if (!overrides?.searchSearxngFn) {
      console.warn(
        '[search] searxng lookup failed, falling back to desearch',
        err?.message ?? err,
      );
    }
    searxError =
      err?.response?.status === 429
        ? 'SearxNG rate limited this request.'
        : err?.message ?? 'SearxNG search failed.';
  }

  // 2) Desearch (Bittensor SN22). Kept as the primary fallback, but it
  // intermittently returns unrelated YouTube videos, so we only trust it when
  // it yields enough non-video results.
  log('Falling back to Desearch...');
  const desearchRes = await desearchSearch(query);
  const desearchResults = dropVideos(
    Array.isArray(desearchRes?.results) ? desearchRes.results : [],
  );
  log(
    `Desearch returned ${desearchRes?.results?.length || 0} results (${desearchResults.length} after video filter)`,
  );
  suggestions = [...new Set([...suggestions, ...(desearchRes?.suggestions ?? [])])];

  if (desearchResults.length >= MIN_GOOD_RESULTS) {
    log(`Using Desearch results (${desearchResults.length})`);
    return { engine: 'desearch', results: desearchResults, suggestions };
  }

  // 3) Serper (reliable Google search) — quality backstop when the providers
  // above are dead (SearxNG) or returned mostly junk (Desearch).
  log('Falling back to Serper...');
  const serperRes = await serperSearch(query);
  const serperResults = dropVideos(
    Array.isArray(serperRes?.results) ? serperRes.results : [],
  );
  log(
    `Serper returned ${serperRes?.results?.length || 0} results (${serperResults.length} after video filter)`,
  );

  if (serperResults.length > 0) {
    return {
      engine: 'serper',
      results: serperResults,
      suggestions: [
        ...new Set([...suggestions, ...(serperRes?.suggestions ?? [])]),
      ],
    };
  }

  // Nothing usable anywhere — return whatever Desearch gave (post-filter) and
  // surface the most relevant error so the caller can show a message.
  const error = serperRes?.error || desearchRes?.error || searxError;
  log(`Web search complete, returning ${desearchResults.length} results`);
  return {
    engine: 'desearch',
    results: desearchResults,
    suggestions,
    ...(error ? { error } : {}),
  };
};
