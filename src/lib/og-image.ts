import axios from 'axios';

export interface OGData {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
}

// Track rate limit errors to avoid overwhelming servers
let rateLimitCount = 0;
const MAX_RATE_LIMITS = 5; // Increased for testing
const RESET_RATE_LIMIT_INTERVAL = 60000; // 1 minute

// Reset rate limit counter periodically
setInterval(() => {
  rateLimitCount = 0;
}, RESET_RATE_LIMIT_INTERVAL);

export const fetchOGData = async (url: string): Promise<OGData | null> => {
  try {
    // Skip if we've hit too many rate limits recently
    if (rateLimitCount >= MAX_RATE_LIMITS) {
      console.warn(`[og-image] Skipping OG fetch for ${url} due to recent rate limits (${rateLimitCount}/${MAX_RATE_LIMITS})`);
      return null;
    }

    // First try to get a quick response by setting a short timeout
    const response = await axios.get(url, {
      timeout: 5000, // Allow more time for slower sites
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChutesSearch/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 3,
      validateStatus: (status) => status < 400, // Accept 2xx and 3xx
    });

    const html = response.data;
    const ogData: OGData = {};

    // Extract meta tags
    const metaTags = html.match(/<meta[^>]*>/gi) || [];

    for (const tag of metaTags) {
      // Extract property and content
      const propertyMatch = tag.match(/property=["']([^"']*)["']/i) ||
                           tag.match(/name=["']([^"']*)["']/i);
      const contentMatch = tag.match(/content=["']([^"']*)["']/i);

      if (propertyMatch && contentMatch) {
        const property = propertyMatch[1].toLowerCase();
        const content = contentMatch[1];

        switch (property) {
          case 'og:title':
            ogData.title = content;
            break;
          case 'og:description':
            ogData.description = content;
            break;
          case 'og:image':
            // Prefer secure URLs and validate
            if (content && content.length > 10) {
              if (content.startsWith('http://')) {
                ogData.image = content.replace('http://', 'https://');
              } else if (content.startsWith('//')) {
                ogData.image = 'https:' + content;
              } else if (!content.startsWith('http')) {
                // Relative URL, try to construct full URL
                try {
                  const urlObj = new URL(url);
                  ogData.image = urlObj.origin + (content.startsWith('/') ? '' : '/') + content;
                } catch {
                  ogData.image = content;
                }
              } else {
                ogData.image = content;
              }
            }
            break;
          case 'og:url':
            ogData.url = content;
            break;
          case 'og:site_name':
            ogData.siteName = content;
            break;
        }
      }
    }

    return ogData.image ? ogData : null;
    } catch (error: any) {
      // Track rate limit errors
      if (error?.response?.status === 429 || error?.response?.status === 503) {
        rateLimitCount++;
        console.warn(`[og-image] Rate limit hit for ${url}, count: ${rateLimitCount}/${MAX_RATE_LIMITS}, status: ${error?.response?.status}`);
      } else if (error?.response?.status) {
        console.warn(`[og-image] HTTP error for ${url}: ${error?.response?.status} - ${error?.response?.statusText}`);
      } else if (error?.code === 'ECONNABORTED') {
        console.warn(`[og-image] Timeout for ${url}`);
      } else {
        console.warn(`[og-image] Failed to fetch OG data for ${url}:`, error.message || error);
      }
      return null;
    }
};

export const fetchOGImage = async (url: string): Promise<string | null> => {
  try {
    console.log(`[og-image] Attempting to fetch OG image for: ${url}`);
    const ogData = await fetchOGData(url);
    if (ogData?.image) {
      console.log(`[og-image] Successfully found OG image for ${url}: ${ogData.image}`);
      return ogData.image;
    } else {
      console.log(`[og-image] No OG image found for ${url}`);
      return null;
    }
  } catch (error) {
    console.warn(`[og-image] Failed to fetch OG image for ${url}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
};

// Batch fetch OG images with rate limiting
export const fetchMultipleOGImages = async (
  urls: string[],
  concurrency: number = 3
): Promise<Record<string, string | null>> => {
  const results: Record<string, string | null> = {};

  // Process in batches to avoid overwhelming servers
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(async (url) => {
      const image = await fetchOGImage(url);
      return { url, image };
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(({ url, image }) => {
      results[url] = image;
    });

    // Small delay between batches
    if (i + concurrency < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
};
