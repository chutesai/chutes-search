import axios from 'axios';

export interface ImageSearchResult {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  source: string;
  domain: string;
  link: string;
  googleUrl: string;
  position: number;
}

export interface ImageSearchResponse {
  searchParameters: {
    q: string;
    type: string;
    engine: string;
    num: number;
  };
  images: ImageSearchResult[];
  credits: number;
}

export interface ImageSearchRequest {
  query: string;
  num?: number; // Number of results (default: 10, max: 100)
}

const SERPER_API_URL = 'https://google.serper.dev/images';

export async function searchImages(request: ImageSearchRequest): Promise<ImageSearchResponse> {
  try {
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      throw new Error('SERPER_API_KEY environment variable not set');
    }

    const headers = {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    };

    const payload = {
      q: request.query,
      num: request.num || 10
    };

    console.log(`[imageSearch] Searching images (queryLen=${request.query.length})`);

    const response = await axios.post(SERPER_API_URL, payload, {
      headers,
      timeout: 10000 // 10 second timeout
    });

    if (response.status === 200) {
      const data = response.data;

      // Validate response structure
      if (!data.images || !Array.isArray(data.images)) {
        throw new Error('Invalid response structure from Serper API');
      }

      return {
        searchParameters: data.searchParameters,
        images: data.images,
        credits: data.credits || 1
      };
    } else {
      throw new Error(`Serper API returned status ${response.status}: ${response.statusText}`);
    }
  } catch (error: any) {
    console.error('Image search error:', error);
    throw new Error(error.message || 'Failed to search images');
  }
}

export async function searchImagesSafe(request: ImageSearchRequest): Promise<ImageSearchResult[]> {
  try {
    const response = await searchImages(request);
    return response.images;
  } catch (error) {
    console.error('Safe image search error:', error);
    return []; // Return empty array on error
  }
}
