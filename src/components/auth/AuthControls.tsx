'use client';

import { useEffect, useMemo, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';

type MeResponse = {
  user: { id: string; username: string | null } | null;
  scope?: string | null;
  hasInvoke?: boolean;
};

export default function AuthControls() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [returnTo, setReturnTo] = useState<string>('/');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = (await res.json()) as MeResponse;
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) setMe({ user: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Avoid Next.js build-time restrictions around useSearchParams().
    setReturnTo(window.location.pathname + window.location.search);
  }, []);

  const loginHref = useMemo(
    () => `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );
  const logoutHref = useMemo(() => `/api/auth/logout?returnTo=/`, []);

  const username = me?.user?.username || (me?.user ? `user:${me.user.id.slice(0, 6)}` : null);

  return (
    <div className="flex flex-col gap-2">
      {loading ? (
        <p className="text-sm text-black/70 dark:text-white/70">Checking sign-in…</p>
      ) : me?.user ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-black/70 dark:text-white/70">Signed in as</p>
            <p className="text-sm font-medium text-black dark:text-white truncate">
              {username}
            </p>
            <p className="text-xs text-black/60 dark:text-white/60">
              {me.hasInvoke
                ? 'Inference runs via your Chutes account'
                : 'Signed in, but missing chutes:invoke permission'}
            </p>
          </div>
          <a
            href={logoutHref}
            className="inline-flex items-center gap-2 rounded-lg border border-light-200 dark:border-dark-200 px-3 py-2 text-sm hover:bg-light-200 dark:hover:bg-dark-200 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </a>
        </div>
      ) : (
        <a
          href={loginHref}
          className="inline-flex items-center gap-2 rounded-lg bg-[#24A0ED] px-3 py-2 text-sm text-white hover:opacity-90 transition-opacity w-fit"
        >
          <LogIn size={16} />
          Sign in with Chutes
        </a>
      )}
    </div>
  );
}
