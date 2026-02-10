import { searchSearxng } from '../searxng';
import { searchSerper } from '../serper';

type UnifiedResult = {
  title: string;
  url: string;
  content?: string;
  thumbnail?: string;
};

export type SearchEngine = 'searxng' | 'serper';

export type SearchRunResult = {
  engine: SearchEngine;
  results: UnifiedResult[];
  suggestions: string[];
  error?: string;
};

type SearchOverrides = {
  searchSerperFn?: typeof searchSerper;
  searchSearxngFn?: typeof searchSearxng;
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
  const log = (msg: string) => console.log(`[webSearch] ${new Date().toISOString()} | +${Date.now() - startTime}ms | ${msg}`);
  
  log(`Starting web search (queryLen=${query.length})`);
  
  const searxngSearch = overrides?.searchSearxngFn ?? searchSearxng;
  const serperSearch = overrides?.searchSerperFn ?? searchSerper;

  let searxSuggestions: string[] = [];
  let searxError: string | undefined;

  try {
    log('Trying SearxNG...');
    const searxngRes = await searxngSearch(query, {
      engines: activeEngines.length > 0 ? activeEngines : undefined,
    });
    log(`SearxNG returned ${searxngRes?.results?.length || 0} results`);

    searxSuggestions = searxngRes?.suggestions ?? [];

    if (Array.isArray(searxngRes?.results) && searxngRes.results.length > 0) {
      log('Using SearxNG results');
      return {
        engine: 'searxng',
        results: normalizeSearxngResults(searxngRes.results),
        suggestions: searxSuggestions,
      };
    }
  } catch (err: any) {
    log(`SearxNG failed: ${err?.message ?? 'unknown error'}`);
    if (!overrides?.searchSearxngFn) {
      console.warn(
        '[search] searxng lookup failed, falling back to serper',
        err?.message ?? err,
      );
    }

    searxError =
      err?.response?.status === 429
        ? 'SearxNG rate limited this request.'
        : err?.message ?? 'SearxNG search failed.';
  }

  log('Falling back to Serper...');
  const serperRes = await serperSearch(query);
  log(`Serper returned ${serperRes?.results?.length || 0} results`);
  
  const serperSuggestions = serperRes?.suggestions ?? [];
  const serperResults = Array.isArray(serperRes?.results)
    ? serperRes.results
    : [];

  const error = serperRes?.error || searxError;

  log(`Web search complete, returning ${serperResults.length} results`);
  return {
    engine: 'serper',
    results: serperResults,
    suggestions: [...new Set([...searxSuggestions, ...serperSuggestions])],
    ...(error ? { error } : {}),
  };
};
