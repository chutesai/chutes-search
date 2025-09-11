import axios from 'axios';

type SerperSearchResult = {
  title: string;
  link: string;
  snippet?: string;
  imageUrl?: string;
};

export const searchSerper = async (
  query: string,
): Promise<{ results: { title: string; url: string; content?: string; thumbnail?: string }[]; suggestions: string[] }> => {
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

    let results = organic.map((r: any) => {
      console.log(`[serper] Full article data:`, JSON.stringify(r, null, 2));
      return {
        title: r.title,
        url: r.link,
        content: r.snippet,
        thumbnail: r.imageUrl || r.image || r.thumbnail || r.imageUrl2,
      };
    });

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
    console.error('[serper] request failed', err?.response?.status, err?.message);
    return { results: [], suggestions: [] };
  }
};


