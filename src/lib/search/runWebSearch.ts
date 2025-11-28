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
  const searxngSearch = overrides?.searchSearxngFn ?? searchSearxng;
  const serperSearch = overrides?.searchSerperFn ?? searchSerper;

  let searxSuggestions: string[] = [];

  try {
    const searxngRes = await searxngSearch(query, {
      engines: activeEngines.length > 0 ? activeEngines : undefined,
    });

    searxSuggestions = searxngRes?.suggestions ?? [];

    if (Array.isArray(searxngRes?.results) && searxngRes.results.length > 0) {
      return {
        engine: 'searxng',
        results: normalizeSearxngResults(searxngRes.results),
        suggestions: searxSuggestions,
      };
    }
  } catch (err: any) {
    if (!overrides?.searchSearxngFn) {
      console.warn(
        '[search] searxng lookup failed, falling back to serper',
        err?.message ?? err,
      );
    }
  }

  const serperRes = await serperSearch(query);
  const serperSuggestions = serperRes?.suggestions ?? [];
  const serperResults = Array.isArray(serperRes?.results)
    ? serperRes.results
    : [];

  return {
    engine: 'serper',
    results: serperResults,
    suggestions: [...new Set([...searxSuggestions, ...serperSuggestions])],
  };
};
