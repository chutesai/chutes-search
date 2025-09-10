import axios from 'axios';

export interface OGData {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
}

export const fetchOGData = async (url: string): Promise<OGData | null> => {
  try {
    // First try to get a quick response by setting a short timeout
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChutesSearch/1.0)',
      },
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
            // Prefer secure URLs
            if (content.startsWith('http://')) {
              ogData.image = content.replace('http://', 'https://');
            } else {
              ogData.image = content;
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
  } catch (error) {
    console.warn(`[og-image] Failed to fetch OG data for ${url}:`, error.message);
    return null;
  }
};

export const fetchOGImage = async (url: string): Promise<string | null> => {
  try {
    const ogData = await fetchOGData(url);
    return ogData?.image || null;
  } catch (error) {
    console.warn(`[og-image] Failed to fetch OG image for ${url}:`, error.message);
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
};
