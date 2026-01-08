'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Discover {
  title: string;
  content?: string;
  url: string;
  thumbnail?: string;
}

const topics: { key: string; display: string }[] = [
  {
    display: 'Tech & Science',
    key: 'tech',
  },
  {
    display: 'Finance',
    key: 'finance',
  },
  {
    display: 'Art & Culture',
    key: 'art',
  },
  {
    display: 'Sports',
    key: 'sports',
  },
  {
    display: 'Entertainment',
    key: 'entertainment',
  },
  {
    display: 'AI',
    key: 'ai',
  },
];

// Helper to get the domain from a URL
const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '').toLowerCase();
  } catch {
    return '';
  }
};

// Check if thumbnail URL is from a CDN/proxy that doesn't match the article domain
const isMismatchedCdnImage = (thumbnailUrl: string, articleUrl: string): boolean => {
  const thumbDomain = getDomain(thumbnailUrl);
  const articleDomain = getDomain(articleUrl);
  
  if (!thumbDomain || !articleDomain) return false;
  
  // List of known CDN/proxy domains that cache images from other sites
  const cdnProxyDomains = [
    'yimg.com',        // Yahoo image CDN
    's.yimg.com',
    'media.zenfs.com', // Yahoo/Zenfs
    'bing.com',
    'googleusercontent.com',
    'gstatic.com',
    'cloudfront.net',
    'akamaihd.net',
    'imgur.com',
    'imgix.net',
  ];
  
  // Check if thumbnail is from a CDN that doesn't match the article
  const isFromCdn = cdnProxyDomains.some(cdn => thumbDomain.includes(cdn));
  const domainMismatch = !thumbDomain.includes(articleDomain) && !articleDomain.includes(thumbDomain);
  
  return isFromCdn && domainMismatch;
};

// Helper to get a safe image URL, or null if it's a mismatched CDN image
const getSafeImageUrl = (thumbnail: string, articleUrl: string): string | null => {
  try {
    // If thumbnail is from a CDN that doesn't match the article, skip it
    if (isMismatchedCdnImage(thumbnail, articleUrl)) {
      console.log(`[ArticleImage] Skipping mismatched CDN image: ${thumbnail} for article: ${articleUrl}`);
      return null;
    }
    
    const url = new URL(thumbnail);
    return url.origin + url.pathname + (url.searchParams.get('id') ? `?id=${url.searchParams.get('id')}` : '');
  } catch {
    return thumbnail;
  }
};

// Helper to get favicon URL from article URL
const getFaviconUrl = (articleUrl: string): string => {
  try {
    const url = new URL(articleUrl);
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`;
  } catch {
    return '';
  }
};

// Image component with fallback chain: thumbnail (if matching domain) -> favicon -> placeholder
const ArticleImage = ({ item }: { item: Discover }) => {
  // Only use thumbnail if it's not from a mismatched CDN
  const validThumbnail = item.thumbnail ? getSafeImageUrl(item.thumbnail, item.url) : null;
  
  const [imgSrc, setImgSrc] = useState<string | null>(validThumbnail);
  const [fallbackAttempted, setFallbackAttempted] = useState(!validThumbnail && !!item.thumbnail); // Already tried if thumbnail was rejected
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [isSmallIcon, setIsSmallIcon] = useState(!validThumbnail); // Start as icon if using favicon

  // If no valid thumbnail, start with favicon
  useEffect(() => {
    if (!validThumbnail && item.url) {
      const faviconUrl = getFaviconUrl(item.url);
      if (faviconUrl) {
        setImgSrc(faviconUrl);
        setFallbackAttempted(true);
        setIsSmallIcon(true);
      } else {
        setShowPlaceholder(true);
      }
    }
  }, [validThumbnail, item.url]);

  const handleError = useCallback(() => {
    if (!fallbackAttempted && item.url) {
      // Try favicon as fallback
      const faviconUrl = getFaviconUrl(item.url);
      if (faviconUrl) {
        setImgSrc(faviconUrl);
        setFallbackAttempted(true);
        setIsSmallIcon(true);
      } else {
        setShowPlaceholder(true);
      }
    } else {
      setShowPlaceholder(true);
    }
  }, [item.url, fallbackAttempted]);

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.target as HTMLImageElement;
    const isSmall = img.naturalWidth < 100 || img.naturalHeight < 100;
    const isIcon = item.thumbnail?.includes('favicon') || item.thumbnail?.includes('icon') || fallbackAttempted;
    setIsSmallIcon(isSmall || isIcon);
  }, [item.thumbnail, fallbackAttempted]);

  if (showPlaceholder) {
    return (
      <div className="w-full aspect-video bg-light-100 dark:bg-dark-100 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-black/30 dark:text-white/30"
        >
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full aspect-video bg-light-100 dark:bg-dark-100 flex items-center justify-center overflow-hidden">
      <img
        className={isSmallIcon ? 'w-12 h-12 object-contain' : 'w-full h-full object-cover'}
        src={imgSrc || ''}
        alt={item.title}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
};

const Page = () => {
  const [discover, setDiscover] = useState<Discover[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<string>(topics[0].key);
  const latestFetchId = useRef(0);
  const cacheRef = useRef<Record<string, Discover[]>>({});
  const prefetchedRef = useRef<Set<string>>(new Set());

  const fetchArticles = useCallback(async (topic: string, isPrefetch = false) => {
    // Check cache first
    if (cacheRef.current[topic]) {
      if (!isPrefetch) {
        setDiscover(cacheRef.current[topic]);
        setLoading(false);
      }
      return;
    }

    const requestId = isPrefetch ? 0 : ++latestFetchId.current;
    if (!isPrefetch) {
      setLoading(true);
    }

    let blogs: Discover[] = [];
    let success = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const params = new URLSearchParams({ topic });

        // Always try preview mode first for better reliability
        if (attempt === 1) {
          params.set('mode', 'preview');
        }

        const res = await fetch(`/api/discover?${params.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: `Failed with status ${res.status}` }));
          throw new Error(errorData?.message || `Failed with status ${res.status}`);
        }

        const data = await res.json().catch(() => ({ blogs: [] })) as { blogs?: Discover[]; message?: string };
        const blogsData = Array.isArray(data.blogs) ? data.blogs : [];
        
        // Filter out invalid entries and ensure we have valid data
        blogs = blogsData.filter((blog: Discover) =>
          blog &&
          typeof blog === 'object' &&
          blog.title &&
          typeof blog.title === 'string' &&
          blog.title.trim().length > 0 &&
          blog.url &&
          typeof blog.url === 'string' &&
          blog.url.trim().length > 0
        );

        // If we got some valid results, consider it a success
        if (blogs.length > 0) {
          success = true;
          break;
        } else if (attempt === 3) {
          // On final attempt, accept even empty results to avoid complete failure
          success = true;
          blogs = [];
          break;
        }
      } catch (err) {
        console.error(`[discover] Error fetching data (attempt ${attempt}):`, err);
        if (attempt < 3) {
          // Exponential backoff: 500ms, 1000ms, 1500ms
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }

    // Cache the results
    if (success && blogs.length > 0) {
      cacheRef.current[topic] = blogs;
    }

    if (!isPrefetch && latestFetchId.current === requestId) {
      if (success) {
        setDiscover(blogs);
      } else {
        setDiscover([]);
        toast.error('Unable to load articles. Please try again later.');
      }
      setLoading(false);
    }
  }, []);

  // Pre-fetch all categories on mount
  useEffect(() => {
    // Fetch active topic first
    fetchArticles(activeTopic);
    
    // Then prefetch other topics in background with delays to avoid rate limiting
    const prefetchOthers = async () => {
      for (const topic of topics) {
        if (topic.key !== activeTopic && !prefetchedRef.current.has(topic.key)) {
          prefetchedRef.current.add(topic.key);
          // Add small delay between prefetch requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          fetchArticles(topic.key, true);
        }
      }
    };
    
    // Start prefetching after a short delay to prioritize main content
    const timer = setTimeout(prefetchOthers, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - intentionally empty deps

  // Handle topic change
  useEffect(() => {
    fetchArticles(activeTopic);
  }, [activeTopic, fetchArticles]);

  return (
    <>
      <div>
        <div className="flex flex-col pt-4">
          <div className="flex items-center">
            <Search />
            <h1 className="text-3xl font-medium p-2">Discover</h1>
          </div>
          <hr className="border-t border-[#2B2C2C] my-4 w-full" />
        </div>

        <div className="flex flex-row items-center space-x-2 overflow-x-auto overflow-hidden-scrollable scrollbar-hide">
          {topics.map((t, i) => (
            <div
              key={i}
              className={cn(
                'border-[0.1px] rounded-full text-sm px-3 py-1 text-nowrap transition duration-200 cursor-pointer',
                activeTopic === t.key
                  ? 'text-cyan-300 bg-cyan-300/30 border-cyan-300/60'
                  : 'border-black/30 dark:border-white/30 text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white hover:border-black/40 dark:hover:border-white/40 hover:bg-black/5 dark:hover:bg-white/5',
              )}
              onClick={() => setActiveTopic(t.key)}
            >
              <span>{t.display}</span>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-row items-center justify-center min-h-screen">
            <svg
              aria-hidden="true"
              className="w-8 h-8 text-light-200 fill-light-secondary dark:text-[#202020] animate-spin dark:fill-[#ffffff3b]"
              viewBox="0 0 100 101"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
                fill="currentColor"
              />
              <path
                d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
                fill="currentFill"
              />
            </svg>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 sm:grid-cols-2 grid-cols-1 gap-4 pb-28 pt-5 lg:pb-8 w-full justify-items-center lg:justify-items-start">
            {discover &&
              discover?.map((item, i) => (
                <Link
                  href={`/?q=Summary: ${item.url}`}
                  key={i}
                  className="max-w-sm rounded-lg overflow-hidden bg-light-secondary dark:bg-dark-secondary hover:-translate-y-[1px] transition duration-200"
                  target="_blank"
                >
                  <ArticleImage item={item} />
                  <div className="px-6 py-4">
                    <div className="font-bold text-lg mb-2">
                      {item.title.slice(0, 100)}...
                    </div>
                    <p className="text-black-70 dark:text-white/70 text-sm">
                      {item.content?.slice(0, 100) || 'No description available'}...
                    </p>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </div>
    </>
  );
};

export default Page;
