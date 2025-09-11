import { searchSerper } from '@/lib/serper';
import { fetchMultipleOGImages } from '@/lib/og-image';
import fs from 'fs/promises';
import path from 'path';

// Rate limiting and error handling for Serper API
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests to be more conservative

// Simple in-memory cache to avoid duplicate requests
const cache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_DURATION = 300000; // 5 minutes

// Filesystem cache for persistent caching
const CACHE_DIR = path.join(process.cwd(), 'cache');
const FS_CACHE_DURATION = 1800000; // 30 minutes for filesystem cache

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.access(CACHE_DIR);
  } catch {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  }
}

// Get cached data from filesystem
async function getFSCache(key: string): Promise<any[] | null> {
  try {
    const cacheFile = path.join(CACHE_DIR, `${key}.json`);
    const cacheData = await fs.readFile(cacheFile, 'utf-8');
    const parsed = JSON.parse(cacheData);

    if (Date.now() - parsed.timestamp < FS_CACHE_DURATION) {
      return parsed.data;
    }

    // Cache expired, remove file
    await fs.unlink(cacheFile).catch(() => {});
    return null;
  } catch {
    return null;
  }
}

// Save data to filesystem cache
async function setFSCache(key: string, data: any[]) {
  try {
    await ensureCacheDir();
    const cacheFile = path.join(CACHE_DIR, `${key}.json`);
    const cacheData = {
      data,
      timestamp: Date.now()
    };
    await fs.writeFile(cacheFile, JSON.stringify(cacheData));
  } catch (error) {
    console.warn('[discover] Failed to save cache:', error);
  }
}

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
    query: ['technology news', 'latest tech developments', 'science breakthroughs', 'innovation', 'gadgets', 'AI developments'],
    links: [
      'techcrunch.com', 'wired.com', 'arstechnica.com', 'theverge.com', 'engadget.com',
      'cnet.com', 'zdnet.com', 'venturebeat.com', 'techradar.com', 'digitaltrends.com',
      'gizmodo.com', 'slashdot.org', 'hackernews.com', 'reuters.com', 'bbc.com'
    ],
    broadSearch: 'technology OR science OR innovation OR AI OR machine learning OR gadgets OR startups OR research -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
  },
  finance: {
    query: ['finance news', 'market updates', 'stock market', 'investing', 'economy news'],
    links: [
      'bloomberg.com', 'wsj.com', 'cnbc.com', 'reuters.com', 'ft.com',
      'forbes.com', 'businessinsider.com', 'marketwatch.com', 'investing.com', 'yahoo.com',
      'seekingalpha.com', 'zacks.com', 'fool.com', 'barrons.com', 'economist.com'
    ],
    broadSearch: 'finance OR markets OR economy OR stocks OR investing OR banking OR cryptocurrency OR trading -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
  },
  art: {
    query: ['art news', 'cultural events', 'contemporary art', 'museum news', 'gallery exhibitions'],
    links: [
      'artnews.com', 'artsy.net', 'artforum.com', 'hyperallergic.com', 'artnet.com',
      'theartnewspaper.com', 'frieze.com', 'artbasel.com', 'phillips.com', 'sothebys.com',
      'christies.com', 'tate.org.uk', 'metmuseum.org', 'guggenheim.org', 'moma.org'
    ],
    broadSearch: 'art OR culture OR museum OR gallery OR painting OR sculpture OR contemporary art OR modern art OR exhibition OR artist -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
  },
  sports: {
    query: ['sports news', 'athletics', 'sports scores', 'football', 'basketball', 'soccer'],
    links: [
      'espn.com', 'sportsillustrated.com', 'cbssports.com', 'foxsports.com', 'nbcsports.com',
      'sports.yahoo.com', 'bleacherreport.com', 'nfl.com', 'nba.com', 'mlb.com',
      'soccer.com', 'goal.com', 'transfermarkt.com', 'theathletic.com', 'sportingnews.com'
    ],
    broadSearch: 'sports OR athletics OR football OR basketball OR soccer OR nba OR nfl OR tennis OR golf OR olympics OR championship -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
  },
  entertainment: {
    query: ['entertainment news', 'celebrity news', 'hollywood news', 'movies', 'tv shows'],
    links: [
      'hollywoodreporter.com', 'variety.com', 'deadline.com', 'ew.com', 'people.com',
      'usmagazine.com', 'tmz.com', 'etonline.com', 'perezhilton.com', 'justjared.com',
      'imdb.com', 'rottentomatoes.com', 'metacritic.com', 'tvguide.com', 'entertainmentweekly.com'
    ],
    broadSearch: 'entertainment OR celebrity OR movies OR music OR film OR television OR hollywood OR awards OR streaming OR netflix OR disney -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
  },
  ai: {
    query: ['artificial intelligence news', 'AI developments', 'machine learning', 'deep learning', 'robotics'],
    links: [
      'techcrunch.com', 'venturebeat.com', 'mit.edu', 'stanford.edu', 'arxiv.org',
      'towardsdatascience.com', 'machinelearningmastery.com', 'deepmind.com', 'openai.com', 'anthropic.com',
      'google.ai', 'microsoft.com', 'ibm.com', 'nvidia.com', 'apple.com'
    ],
    broadSearch: 'artificial intelligence OR AI OR machine learning OR deep learning OR neural networks OR robotics OR automation OR computer vision -site:pinterest.com -site:facebook.com -site:twitter.com -site:instagram.com -site:youtube.com'
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
    const now = Date.now();

    // Check in-memory cache first
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log(`[discover] Returning in-memory cached data with ${cached.data.length} blogs`);
      return Response.json(
        {
          blogs: cached.data,
          cached: true,
          timestamp: cached.timestamp,
          cacheType: 'memory'
        },
        {
          status: 200,
        },
      );
    }

    // Check filesystem cache
    const fsCached = await getFSCache(cacheKey);
    if (fsCached) {
      console.log(`[discover] Returning filesystem cached data with ${fsCached.length} blogs`);
      // Update in-memory cache
      cache.set(cacheKey, { data: fsCached, timestamp: now });
      return Response.json(
        {
          blogs: fsCached,
          cached: true,
          timestamp: now,
          cacheType: 'filesystem'
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
      const allResults = [];

      // First, get results from a diverse selection of trusted sites (limit to 8 for performance)
      const selectedSites = selectedTopic.links.slice(0, 8); // Use first 8 sites for diversity
      console.log(`[discover] Fetching from ${selectedSites.length} selected sites: ${selectedSites.join(', ')}`);

      for (const link of selectedSites) {
        try {
          // Use a random query from the topic's query array for variety
          const randomQuery = selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)];
          const result = await rateLimitedSearchSerper(`${randomQuery} site:${link}`);
          allResults.push(...result.results);
          console.log(`[discover] Got ${result.results.length} results from ${link} using query: "${randomQuery}"`);
        } catch (err) {
          console.warn(`[discover] Failed to fetch from ${link}:`, err);
          // Continue with other requests even if one fails
        }
      }

      // Then, get broader results for more variety (always include some for diversity)
      if (selectedTopic.broadSearch) {
        console.log(`[discover] Fetching broader results for topic ${topic} with query: ${selectedTopic.broadSearch}`);
        try {
          const broadResult = await rateLimitedSearchSerper(selectedTopic.broadSearch);
          console.log(`[discover] Broader search returned ${broadResult.results.length} results`);

          // Take broad results to ensure variety, but prioritize quality
          const broadResults = broadResult.results.slice(0, 15);
          console.log(`[discover] Broader result domains:`, broadResults.map(r => {
            try {
              return new URL(r.url).hostname.replace('www.', '');
            } catch {
              return 'invalid-url';
            }
          }));

          allResults.push(...broadResults);
          console.log(`[discover] Added ${broadResults.length} broader results for ${topic}`);
        } catch (err) {
          console.warn(`[discover] Failed to fetch broad search for ${topic}:`, err);
        }
      }

      // Separate site-specific and broader results for better variety
      const siteSpecificResults = allResults.slice(0, allResults.length - 15); // First N results are from specific sites
      const broaderResults = allResults.slice(-15); // Last 15 results are from broader search

      // Filter duplicates but be more lenient with broader results to ensure variety
      const filteredSiteResults = siteSpecificResults.filter((item) => {
        const url = item.url?.toLowerCase().trim();
        if (seenUrls.has(url)) return false;
        seenUrls.add(url);
        return true;
      });

      const filteredBroaderResults = broaderResults.filter((item) => {
        const url = item.url?.toLowerCase().trim();
        if (seenUrls.has(url)) return false;
        seenUrls.add(url);
        return true;
      });

      // Combine results with preference for variety: take site results + broader results
      data = [...filteredSiteResults, ...filteredBroaderResults]
        .sort(() => Math.random() - 0.5);

      console.log(`[discover] Final variety: ${filteredSiteResults.length} site-specific + ${filteredBroaderResults.length} broader results = ${data.length} total`);

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

      // Robust fallback chain: OG images -> High-quality images -> Favicons -> Generic placeholders
      const siteThumbnails: Record<string, string> = {
        // High-quality images for major sites
        'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
        'venturebeat.com': 'https://venturebeat.com/wp-content/themes/vbnews/img/favicon.ico',
        'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
        'artnews.com': 'https://www.artnews.com/wp-content/themes/vip/pmc-artnews/assets/dist/img/favicon.ico',
        'artsy.net': 'https://www.artsy.net/images/favicon.ico',
        'espn.com': 'https://a.espncdn.com/favicon.ico',
        'hollywoodreporter.com': 'https://www.hollywoodreporter.com/wp-content/themes/pmc-hollywood-reporter/assets/app/icons/favicon.ico',
        'variety.com': 'https://variety.com/wp-content/themes/vip/pmc-variety-2020/assets/app/icons/favicon.ico',
        'wired.com': 'https://www.wired.com/favicon.ico',
        'arstechnica.com': 'https://cdn.arstechnica.net/favicon.ico',
        'wsj.com': 'https://www.wsj.com/favicon.ico',
        'sportsillustrated.com': 'https://www.si.com/favicon.ico',
        'mit.edu': 'https://web.mit.edu/favicon.ico',
      };

      // Force high-quality images for specific sites
      const highQualityOverrides: Record<string, string> = {
        'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
        'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
      };

      // Apply robust fallback thumbnails for articles without thumbnails
      let fallbackCount = 0;
      data.forEach(item => {
        if (!item.thumbnail) {
          try {
            const url = new URL(item.url);
            const domain = url.hostname.replace('www.', '');

            // First priority: High-quality overrides
            if (highQualityOverrides[domain]) {
              item.thumbnail = highQualityOverrides[domain];
              fallbackCount++;
              console.log(`[discover] Applied high-quality override for ${domain}`);
            }
            // Second priority: Site-specific thumbnails
            else if (siteThumbnails[domain]) {
              item.thumbnail = siteThumbnails[domain];
              fallbackCount++;
              console.log(`[discover] Applied site-specific thumbnail for ${domain}`);
            }
            // Third priority: Generic favicon fallback
            else {
              // Try to construct a favicon URL
              const faviconUrl = `https://${domain}/favicon.ico`;
              item.thumbnail = faviconUrl;
              console.log(`[discover] Applied favicon fallback for ${domain}: ${faviconUrl}`);
            }
          } catch (error) {
            // Final fallback: Generic placeholder
            item.thumbnail = 'https://via.placeholder.com/150x100?text=Image';
            console.log(`[discover] Applied generic placeholder for ${item.url}`);
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

            // Robust fallback chain for preview mode
            const previewSiteThumbnails: Record<string, string> = {
              'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
              'venturebeat.com': 'https://venturebeat.com/wp-content/themes/vbnews/img/favicon.ico',
              'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
              'artnews.com': 'https://www.artnews.com/wp-content/themes/vip/pmc-artnews/assets/dist/img/favicon.ico',
              'artsy.net': 'https://www.artsy.net/images/favicon.ico',
              'espn.com': 'https://a.espncdn.com/favicon.ico',
              'hollywoodreporter.com': 'https://www.hollywoodreporter.com/wp-content/themes/pmc-hollywood-reporter/assets/app/icons/favicon.ico',
              'variety.com': 'https://variety.com/wp-content/themes/vip/pmc-variety-2020/assets/app/icons/favicon.ico',
              'wired.com': 'https://www.wired.com/favicon.ico',
              'arstechnica.com': 'https://cdn.arstechnica.net/favicon.ico',
              'wsj.com': 'https://www.wsj.com/favicon.ico',
              'sportsillustrated.com': 'https://www.si.com/favicon.ico',
              'mit.edu': 'https://web.mit.edu/favicon.ico',
            };

            const previewHighQualityOverrides: Record<string, string> = {
              'bloomberg.com': 'https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i5PGsA7G0NRA/v0/1200x630.png',
              'techcrunch.com': 'https://techcrunch.com/wp-content/uploads/2022/12/tc-logo-2021.svg',
            };

            data.forEach(item => {
              if (!item.thumbnail) {
                try {
                  const url = new URL(item.url);
                  const domain = url.hostname.replace('www.', '');

                  if (previewHighQualityOverrides[domain]) {
                    item.thumbnail = previewHighQualityOverrides[domain];
                  } else if (previewSiteThumbnails[domain]) {
                    item.thumbnail = previewSiteThumbnails[domain];
                  } else {
                    const faviconUrl = `https://${domain}/favicon.ico`;
                    item.thumbnail = faviconUrl;
                  }
                } catch (error) {
                  item.thumbnail = 'https://via.placeholder.com/150x100?text=Image';
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

    // Cache the results in both memory and filesystem
    cache.set(cacheKey, { data, timestamp: now });
    await setFSCache(cacheKey, data);

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
