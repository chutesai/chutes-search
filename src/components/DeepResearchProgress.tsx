import { AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';

const ORDER = [
  'search',
  'sandbox',
  'setup',
  'browser',
  'crawl',
  'analysis',
  'finalize',
  'cleanup',
] as const;

const statusStyles = {
  pending: 'text-black/40 dark:text-white/30',
  running: 'text-[#24A0ED]',
  complete: 'text-emerald-500',
  error: 'text-red-500',
} as const;

type ProgressItem = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  detail?: string;
  percent?: number;
};

const renderIcon = (status: ProgressItem['status']) => {
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  if (status === 'complete') {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (status === 'error') {
    return <AlertTriangle className="h-4 w-4" />;
  }
  return <Circle className="h-3 w-3" />;
};

const toUserFacing = (value: string | undefined) => {
  if (!value) return value;
  // Keep the UI free of implementation details (e.g. "Playwright").
  return value.replace(/Playwright/g, 'Browser');
};

const DeepResearchProgress = ({ progress }: { progress: ProgressItem[] }) => {
  const sorted = [...progress].sort((a, b) => {
    const aIndex = ORDER.indexOf(a.id as (typeof ORDER)[number]);
    const bIndex = ORDER.indexOf(b.id as (typeof ORDER)[number]);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  const isRunning = sorted.some((item) => item.status === 'running');

  return (
    <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/60 dark:bg-dark-secondary/60 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-black dark:text-white">
            {isRunning ? 'Deep research in progress' : 'Deep research steps'}
          </p>
          <p className="text-xs text-black/60 dark:text-white/50">
            {isRunning
              ? 'We are visiting sources and drafting a report. This can take a minute.'
              : 'Review how the report was assembled.'}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {sorted.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
            <div className={`mt-0.5 ${statusStyles[item.status]}`}>
              {renderIcon(item.status)}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm text-black dark:text-white">
                  {toUserFacing(item.label)}
                </p>
                {item.status === 'running' &&
                  typeof item.percent === 'number' && (
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {item.percent}%
                  </span>
                )}
              </div>
              {item.detail && (
                <p className="text-xs text-black/50 dark:text-white/50">
                  {toUserFacing(item.detail)}
                </p>
              )}
              {item.status === 'running' && typeof item.percent === 'number' && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-light-200 dark:bg-dark-200">
                  <div
                    className="h-1.5 rounded-full bg-[#24A0ED]"
                    style={{ width: `${Math.min(Math.max(item.percent, 0), 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DeepResearchProgress;
