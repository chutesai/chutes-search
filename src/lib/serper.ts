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
const SERPER_VIDEOS_API_URL = 'https://google.serper.dev/videos';

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

type SerperVideoResult = {
  title?: string;
  link?: string;
  snippet?: string;
  imageUrl?: string;
  channel?: string;
  duration?: string;
};

/**
 * Reliable video (YouTube) search via Serper. Used by the youtubeSearch focus
 * mode — Desearch's /web endpoint has no video-specific mode and the configured
 * SearxNG instance is down, so this gives dependable, on-topic YouTube results.
 */
export const searchSerperVideos = async (
  query: string,
): Promise<SerperResponse> => {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { results: [], suggestions: [], error: '[serper] SERPER_API_KEY not set' };
  }

  try {
    const res = await axios.post<{ videos?: SerperVideoResult[] }>(
      SERPER_VIDEOS_API_URL,
      { q: query },
      {
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        timeout: 10000,
      },
    );

    const videos = Array.isArray(res.data?.videos) ? res.data.videos : [];
    const results = videos
      .map((v) => {
        const url = v.link;
        if (!url || !v.title) return null;
        return {
          title: v.title,
          url,
          content:
            v.snippet ||
            [v.channel, v.duration].filter(Boolean).join(' · ') ||
            v.title,
          thumbnail: v.imageUrl,
        };
      })
      .filter(Boolean) as SerperResponse['results'];

    return { results, suggestions: [] };
  } catch (err: any) {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.message || err?.message || 'Serper videos request failed';
    console.error('[serper] videos request failed', status, message);
    return {
      results: [],
      suggestions: [],
      error: `[serper] ${message}${status ? ` (status ${status})` : ''}`,
    };
  }
};
