import axios from 'axios';

type SerperSearchResult = {
  title: string;
  link: string;
  snippet?: string;
};

export const searchSerper = async (
  query: string,
): Promise<{ results: { title: string; url: string; content?: string }[]; suggestions: string[] }> => {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn('[serper] SERPER_API_KEY not set; returning empty results');
    return { results: [], suggestions: [] };
  }

  const url = 'https://google.serper.dev/search';
  const headers = {
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  } as const;

  try {
    const res = await axios.post(url, { q: query }, { headers, timeout: 15000 });

  const organic: SerperSearchResult[] = res.data?.organic || [];
  const suggestions: string[] = (res.data?.relatedSearches || [])
    .map((s: any) => s?.query)
    .filter(Boolean);

    const results = organic.map((r) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    }));

    return { results, suggestions };
  } catch (err: any) {
    console.error('[serper] request failed', err?.response?.status, err?.message);
    return { results: [], suggestions: [] };
  }
};


