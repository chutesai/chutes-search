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

    // RE-ENABLE CACHE but add debug info
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log(`[discover] Returning cached data with ${cached.data.length} blogs`);
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

      // If no results from Serper, add mock data for testing
      if (data.length === 0) {
        console.log(`[discover] No results from Serper, adding mock data`);
        data = [
          {
            title: 'Mock Article 1',
            url: 'https://example.com/article1',
            content: 'This is a mock article for testing thumbnails',
            thumbnail: 'https://via.placeholder.com/150x100?text=Mock1'
          },
          {
            title: 'Mock Article 2',
            url: 'https://example.com/article2',
            content: 'This is another mock article for testing thumbnails',
            thumbnail: 'https://via.placeholder.com/150x100?text=Mock2'
          }
        ];
      }

      // First, fetch OG images for articles without thumbnails from Serper
      const articlesWithoutThumbnails = data.filter(item => !item.thumbnail);
      if (articlesWithoutThumbnails.length > 0) {
        console.log(`[discover] Fetching OG images for ${articlesWithoutThumbnails.length} articles without thumbnails`);
        try {
          const ogImages = await fetchMultipleOGImages(
            articlesWithoutThumbnails.map(item => item.url),
            3 // Higher concurrency for better performance
          );

          console.log(`[discover] OG image results:`, ogImages);

          // Update articles with OG images
          let ogUpdatedCount = 0;
          data.forEach(item => {
            const ogImage = ogImages[item.url];
            if (ogImage) {
              item.thumbnail = ogImage;
              ogUpdatedCount++;
            }
          });
          console.log(`[discover] Updated ${ogUpdatedCount} articles with OG images`);
        } catch (error) {
          console.warn('[discover] Failed to fetch OG images:', error);
        }
      }

      // Fallback: Add high-quality thumbnails for popular sites
      const siteThumbnails: Record<string, string> = {
        'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
        'venturebeat.com': 'https://venturebeat.com/wp-content/themes/vbnews/img/favicon.ico',
        'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
        'artnews.com': 'https://www.artnews.com/wp-content/themes/vip/pmc-artnews/assets/dist/img/favicon.ico',
        'espn.com': 'https://a.espncdn.com/favicon.ico',
        'hollywoodreporter.com': 'https://www.hollywoodreporter.com/wp-content/themes/pmc-hollywood-reporter/assets/app/icons/favicon.ico',
      };

      // Force high-quality images for Bloomberg articles
      data.forEach(item => {
        if (!item.thumbnail && item.url.includes('bloomberg.com')) {
          item.thumbnail = 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png';
        }
      });

      // Apply fallback thumbnails only for articles without thumbnails
      let fallbackCount = 0;
      data.forEach(item => {
        if (!item.thumbnail) {
          try {
            const url = new URL(item.url);
            const domain = url.hostname.replace('www.', '');
            if (siteThumbnails[domain]) {
              item.thumbnail = siteThumbnails[domain];
              fallbackCount++;
            } else {
              // Use a generic placeholder for unknown domains
              item.thumbnail = `https://via.placeholder.com/150x100?text=${encodeURIComponent(domain)}`;
            }
          } catch (error) {
            item.thumbnail = 'https://via.placeholder.com/150x100?text=Unknown';
          }
        }
      });
      console.log(`[discover] Applied ${fallbackCount} fallback thumbnails`);
    } else {
      const randomLink = selectedTopic.links[Math.floor(Math.random() * selectedTopic.links.length)];
      const randomQuery = selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)];
      try {
        data = (await rateLimitedSearchSerper(`${randomQuery} site:${randomLink}`)).results;

        // Fetch OG images for preview mode as well
        const articlesWithoutThumbnails = data.filter(item => !item.thumbnail);
        if (articlesWithoutThumbnails.length > 0) {
          console.log(`[discover] Fetching OG images for preview mode (${articlesWithoutThumbnails.length} articles)`);
          try {
            const ogImages = await fetchMultipleOGImages(
              articlesWithoutThumbnails.map(item => item.url),
              1 // Single request for preview mode
            );

            console.log(`[discover] Preview OG image results:`, ogImages);

            data.forEach(item => {
              const ogImage = ogImages[item.url];
              if (ogImage) {
                item.thumbnail = ogImage;
              }
            });

            // Fallback: Add high-quality thumbnails for popular sites in preview mode
            const siteThumbnails: Record<string, string> = {
              'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
              'venturebeat.com': 'https://venturebeat.com/wp-content/themes/vbnews/img/favicon.ico',
              'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
              'artnews.com': 'https://www.artnews.com/wp-content/themes/vip/pmc-artnews/assets/dist/img/favicon.ico',
              'espn.com': 'https://a.espncdn.com/favicon.ico',
              'hollywoodreporter.com': 'https://www.hollywoodreporter.com/wp-content/themes/pmc-hollywood-reporter/assets/app/icons/favicon.ico',
            };

            data.forEach(item => {
              if (!item.thumbnail) {
                try {
                  const url = new URL(item.url);
                  const domain = url.hostname.replace('www.', '');
                  if (siteThumbnails[domain]) {
                    item.thumbnail = siteThumbnails[domain];
                  } else {
                    item.thumbnail = `https://via.placeholder.com/150x100?text=${encodeURIComponent(domain)}`;
                  }
                } catch (error) {
                  item.thumbnail = 'https://via.placeholder.com/150x100?text=Unknown';
                }
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

    console.log(`[discover] Final response with ${data.length} blogs:`, data.map(item => ({ title: item.title, url: item.url, thumbnail: item.thumbnail })));
    console.log(`[discover] Sample blog with thumbnail:`, data[0]);

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
