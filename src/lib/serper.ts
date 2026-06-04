import axios from 'axios';

type SerperOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
  imageUrl?: string;
};

type SerperResponse = {
  results: {
    title: string;
    url: string;
    content?: string;
    thumbnail?: string;
  }[];
  suggestions: string[];
  error?: string;
};

const SERPER_WEB_API_URL = 'https://google.serper.dev/search';

/**
 * Reliable Google-backed web search via Serper. Used as a quality fallback when
 * the primary providers (SearxNG / Desearch) are unavailable or return mostly
 * irrelevant results (Desearch intermittently returns unrelated YouTube videos
 * for normal web queries — see runWebSearch).
 */
export const searchSerper = async (query: string): Promise<SerperResponse> => {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    const error = '[serper] SERPER_API_KEY not set';
    console.warn(`${error}; returning empty results`);
    return { results: [], suggestions: [], error };
  }

  try {
    const res = await axios.post<{
      organic?: SerperOrganicResult[];
      relatedSearches?: { query?: string }[];
    }>(
      SERPER_WEB_API_URL,
      { q: query },
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    const organic = Array.isArray(res.data?.organic) ? res.data.organic : [];

    const results = organic
      .map((r) => {
        const url = r.link;
        if (!url || !r.title) return null;
        return {
          title: r.title,
          url,
          content: r.snippet,
          thumbnail: r.imageUrl,
        };
      })
      .filter(Boolean) as SerperResponse['results'];

    const suggestions = (res.data?.relatedSearches ?? [])
      .map((s) => s?.query ?? '')
      .filter(Boolean);

    return { results, suggestions };
  } catch (err: any) {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.message || err?.message || 'Serper request failed';
    console.error('[serper] request failed', status, message);
    return {
      results: [],
      suggestions: [],
      error: `[serper] ${message}${status ? ` (status ${status})` : ''}`,
    };
  }
};
