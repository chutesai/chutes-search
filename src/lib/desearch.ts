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

export const searchDesearch = async (
  query: string,
): Promise<DesearchResponse> => {
  const apiKey = process.env.DESEARCH_API_KEY;
  if (!apiKey) {
    const error = '[desearch] DESEARCH_API_KEY not set';
    console.warn(`${error}; returning empty results`);
    return { results: [], suggestions: [], error };
  }

  try {
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

    const results = rawResults
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

    return { results, suggestions: [] };
  } catch (err: any) {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.error ||
      err?.response?.data?.message ||
      err?.message ||
      'Desearch request failed';
    console.error('[desearch] request failed', status, message);
    return {
      results: [],
      suggestions: [],
      error: `[desearch] ${message}${status ? ` (status ${status})` : ''}`,
    };
  }
};
