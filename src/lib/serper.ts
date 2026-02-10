import axios from 'axios';

type SerperSearchResult = {
  title: string;
  link: string;
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

export const searchSerper = async (query: string): Promise<SerperResponse> => {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    const error = '[serper] SERPER_API_KEY not set';
    console.warn(`${error}; returning empty results`);
    return { results: [], suggestions: [], error };
  }

    const url = 'https://google.serper.dev/search';
    const headers = {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    } as const;

    try {
      // Add parameters to get images
      const payload = {
        q: query,
        num: 10,
        // Try to get images
      };
      const res = await axios.post(url, payload, { headers, timeout: 15000 });

    const organic: SerperSearchResult[] = res.data?.organic || [];
    const suggestions: string[] = (res.data?.relatedSearches || [])
      .map((s: any) => s?.query)
      .filter(Boolean);

    const results = organic.map((r: any) => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
      thumbnail: r.imageUrl || r.image || r.thumbnail || r.imageUrl2,
    }));

    if ((!results || results.length === 0) && res.data?.knowledgeGraph) {
      const kg = res.data.knowledgeGraph;
      if (kg.title && (kg.description || kg.descriptionLink)) {
        results.push({
          title: kg.title,
          url: kg.descriptionLink || 'https://google.com/search?q=' + encodeURIComponent(query),
          content: kg.description,
          thumbnail: undefined,
        });
      }
    }

    if ((!results || results.length === 0) && Array.isArray(res.data?.topStories)) {
      for (const s of res.data.topStories) {
        if (s.title && s.link) {
          results.push({ title: s.title, url: s.link, content: s.source || s.date, thumbnail: undefined });
        }
      }
    }

    return { results, suggestions };
  } catch (err: any) {
    const status = err?.response?.status;
    const message =
      err?.response?.data?.message ||
      err?.message ||
      'Serper request failed';
    console.error('[serper] request failed', status, message);
    return {
      results: [],
      suggestions: [],
      error: `[serper] ${message}${status ? ` (status ${status})` : ''}`,
    };
  }
};
