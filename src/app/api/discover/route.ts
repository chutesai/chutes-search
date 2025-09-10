import { searchSerper } from '@/lib/serper';
import { fetchMultipleOGImages } from '@/lib/og-image';

// Rate limiting and error handling for Serper API
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests to be more conservative

// Simple in-memory cache to avoid duplicate requests
const cache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_DURATION = 300000; // 5 minutes

const rateLimitedSearchSerper = async (query: string) => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();

  try {
    const result = await searchSerper(query);
    return result;
  } catch (err: any) {
    if (err?.response?.status === 429) {
      console.warn(`[discover] Rate limit hit for query: ${query}, returning empty results`);
      return { results: [], suggestions: [] };
    }
    throw err;
  }
};

const websitesForTopic = {
  tech: {
    query: ['technology news'],
    links: ['techcrunch.com'],
  },
  finance: {
    query: ['finance news'],
    links: ['bloomberg.com'],
  },
  art: {
    query: ['art news'],
    links: ['artnews.com'],
  },
  sports: {
    query: ['sports news'],
    links: ['espn.com'],
  },
  entertainment: {
    query: ['entertainment news'],
    links: ['hollywoodreporter.com'],
  },
  ai: {
    query: ['artificial intelligence news', 'AI developments'],
    links: ['techcrunch.com', 'venturebeat.com'],
  },
};

type Topic = keyof typeof websitesForTopic;

export const GET = async (req: Request) => {
  try {
    const params = new URL(req.url).searchParams;

    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic = (params.get('topic') as Topic) || 'tech';

    const cacheKey = `${topic}-${mode}`;
    const cached = cache.get(cacheKey);
    const now = Date.now();

    // Return cached data if it's still fresh
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      return Response.json(
        {
          blogs: cached.data,
        },
        {
          status: 200,
        },
      );
    }

    const selectedTopic = websitesForTopic[topic];

    let data: { title: string; url: string; content?: string; thumbnail?: string }[] = [];

    if (mode === 'normal') {
      const seenUrls = new Set();
      const allRequests = selectedTopic.links.flatMap((link) =>
        selectedTopic.query.map((query) => ({ link, query }))
      );

      // Process requests sequentially to avoid rate limits
      const allResults = [];
      for (const { link, query } of allRequests) {
        try {
          const result = await rateLimitedSearchSerper(`${query} site:${link}`);
          allResults.push(...result.results);
        } catch (err) {
          console.warn(`[discover] Failed to fetch ${query} site:${link}:`, err);
          // Continue with other requests even if one fails
        }
      }

      data = allResults
        .filter((item) => {
          const url = item.url?.toLowerCase().trim();
          if (seenUrls.has(url)) return false;
          seenUrls.add(url);
          return true;
        })
        .sort(() => Math.random() - 0.5);

      // Fetch OG images for articles without thumbnails
      const articlesWithoutThumbnails = data.filter(item => !item.thumbnail);
      console.log(`[discover] Found ${articlesWithoutThumbnails.length} articles without thumbnails out of ${data.length} total`);
      if (articlesWithoutThumbnails.length > 0) {
        try {
          console.log(`[discover] Fetching OG images for ${articlesWithoutThumbnails.length} articles:`, articlesWithoutThumbnails.map(item => item.url));
          const ogImages = await fetchMultipleOGImages(
            articlesWithoutThumbnails.map(item => item.url),
            1 // Single request at a time to be very respectful
          );

          console.log(`[discover] OG image results:`, ogImages);

          // Update articles with OG images
          let updatedCount = 0;
          data.forEach(item => {
            if (!item.thumbnail && ogImages[item.url]) {
              item.thumbnail = ogImages[item.url];
              updatedCount++;
            }
          });
          console.log(`[discover] Updated ${updatedCount} articles with OG images`);
        } catch (error) {
          console.warn('[discover] Failed to fetch OG images:', error);
          // Continue without OG images if fetching fails
        }
      }
    } else {
      const randomLink = selectedTopic.links[Math.floor(Math.random() * selectedTopic.links.length)];
      const randomQuery = selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)];
      try {
        data = (await rateLimitedSearchSerper(`${randomQuery} site:${randomLink}`)).results;

        // Fetch OG images for preview mode as well
        const articlesWithoutThumbnails = data.filter(item => !item.thumbnail);
        if (articlesWithoutThumbnails.length > 0) {
          try {
            const ogImages = await fetchMultipleOGImages(
              articlesWithoutThumbnails.map(item => item.url),
              1 // Single request for preview mode to be very respectful
            );

            data.forEach(item => {
              if (!item.thumbnail && ogImages[item.url]) {
                item.thumbnail = ogImages[item.url];
              }
            });
          } catch (error) {
            console.warn('[discover] Failed to fetch OG images for preview:', error);
          }
        }
      } catch (err) {
        console.warn(`[discover] Failed to fetch preview data:`, err);
        data = []; // Return empty array on error
      }
    }

    // Cache the results
    cache.set(cacheKey, { data, timestamp: now });

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
