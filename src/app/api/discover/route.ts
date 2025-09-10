import { searchSerper } from '@/lib/serper';

// Simple rate limiting to prevent hitting API limits
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests

const rateLimitedSearchSerper = async (query: string) => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
  return await searchSerper(query);
};

const websitesForTopic = {
  tech: {
    query: ['technology news', 'latest tech'],
    links: ['techcrunch.com', 'wired.com'],
  },
  finance: {
    query: ['finance news', 'stock market'],
    links: ['bloomberg.com', 'cnbc.com'],
  },
  art: {
    query: ['art news', 'culture'],
    links: ['artnews.com', 'hyperallergic.com'],
  },
  sports: {
    query: ['sports news', 'latest sports'],
    links: ['espn.com', 'bbc.com/sport'],
  },
  entertainment: {
    query: ['entertainment news', 'movies'],
    links: ['hollywoodreporter.com', 'variety.com'],
  },
};

type Topic = keyof typeof websitesForTopic;

export const GET = async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;

    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic: Topic = (params.get('topic') as Topic) || 'tech';

    const selectedTopic = websitesForTopic[topic];

    let data = [];

    if (mode === 'normal') {
      const seenUrls = new Set();

      data = (
        await Promise.all(
          selectedTopic.links.flatMap((link) =>
            selectedTopic.query.map(async (query) => {
              const result = await rateLimitedSearchSerper(`${query} site:${link}`);
              return result.results;
            }),
          ),
        )
      )
        .flat()
        .filter((item) => {
          const url = item.url?.toLowerCase().trim();
          if (seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
        })
        .sort(() => Math.random() - 0.5);
    } else {
      const randomLink = selectedTopic.links[Math.floor(Math.random() * selectedTopic.links.length)];
      const randomQuery = selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)];
      data = (await rateLimitedSearchSerper(`${randomQuery} site:${randomLink}`)).results;
    }

    return Response.json(
      {
        blogs: data,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error(`An error occurred in discover route: ${err}`);
    return Response.json(
      {
        message: 'An error has occurred',
      },
      {
        status: 500,
      },
    );
  }
};
