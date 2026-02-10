import { useEffect, useState } from 'react';

interface Article {
  title: string;
  content: string;
  url: string;
  thumbnail: string;
}

// Helper to get a safe image URL
const getSafeImageUrl = (thumbnail: string): string => {
  try {
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
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
  } catch {
    return '';
  }
};

const NewsArticleWidget = () => {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    fetch('/api/discover?mode=preview')
      .then((res) => res.json())
      .then((data) => {
        const articles = (data.blogs || []).filter((a: Article) => a.title && a.url);
        if (articles.length === 0) {
          setError(true);
          setLoading(false);
          return;
        }
        const selected = articles[Math.floor(Math.random() * articles.length)];
        setArticle(selected);
        if (selected?.thumbnail) {
          setImgSrc(getSafeImageUrl(selected.thumbnail));
        }
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  const handleImageError = () => {
    if (article && imgSrc && !imgError) {
      // Try favicon as fallback
      const faviconUrl = getFaviconUrl(article.url);
      if (faviconUrl && imgSrc !== faviconUrl) {
        setImgSrc(faviconUrl);
      } else {
        setImgError(true);
      }
    } else {
      setImgError(true);
    }
  };

  return (
    <div className="bg-light-secondary dark:bg-dark-secondary rounded-xl border border-light-200 dark:border-dark-200 shadow-sm flex flex-row items-center w-full h-24 min-h-[96px] max-h-[96px] px-3 py-2 gap-3 overflow-hidden">
      {loading ? (
        <>
          <div className="animate-pulse flex flex-row items-center w-full h-full">
            <div className="rounded-lg w-16 min-w-16 max-w-16 h-16 min-h-16 max-h-16 bg-light-200 dark:bg-dark-200 mr-3" />
            <div className="flex flex-col justify-center flex-1 h-full w-0 gap-2">
              <div className="h-4 w-3/4 rounded bg-light-200 dark:bg-dark-200" />
              <div className="h-3 w-1/2 rounded bg-light-200 dark:bg-dark-200" />
            </div>
          </div>
        </>
      ) : error ? (
        <div className="w-full text-xs text-red-400">Could not load news.</div>
      ) : article ? (
        <a
          href={`/?q=Summary: ${article.url}`}
          className="flex flex-row items-center w-full h-full group"
        >
          {imgSrc && !imgError ? (
            <img
              className="object-cover rounded-lg w-16 min-w-16 max-w-16 h-16 min-h-16 max-h-16 border border-light-200 dark:border-dark-200 bg-light-200 dark:bg-dark-200 group-hover:opacity-90 transition"
              src={imgSrc}
              alt={article.title}
              onError={handleImageError}
            />
          ) : (
            <div className="rounded-lg w-16 min-w-16 max-w-16 h-16 min-h-16 max-h-16 border border-light-200 dark:border-dark-200 bg-light-200 dark:bg-dark-200 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-black/30 dark:text-white/30"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
            </div>
          )}
          <div className="flex flex-col justify-center flex-1 h-full pl-3 w-0">
            <div className="font-bold text-xs text-black dark:text-white leading-tight truncate overflow-hidden whitespace-nowrap">
              {article.title}
            </div>
            <p className="text-black/70 dark:text-white/70 text-xs leading-snug truncate overflow-hidden whitespace-nowrap">
              {article.content}
            </p>
          </div>
        </a>
      ) : null}
    </div>
  );
};

export default NewsArticleWidget;
