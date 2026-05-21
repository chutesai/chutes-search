'use client';

import { useCallback, useEffect, useState } from 'react';

export type AuthMeResponse = {
  user: { id: string; username: string | null } | null;
  scope?: string | null;
  hasInvoke?: boolean;
};

const AUTH_REFRESH_THROTTLE_MS = 60 * 1000;
const AUTH_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

let cachedAuthMe: AuthMeResponse | null = null;
let inFlightAuthMe: Promise<AuthMeResponse> | null = null;
let lastRefreshStartedAt = 0;

async function fetchAuthMe(options?: { force?: boolean }): Promise<AuthMeResponse> {
  const now = Date.now();
  if (!options?.force && cachedAuthMe && now - lastRefreshStartedAt < AUTH_REFRESH_THROTTLE_MS) {
    return cachedAuthMe;
  }

  if (inFlightAuthMe) {
    return inFlightAuthMe;
  }

  lastRefreshStartedAt = now;
  inFlightAuthMe = (async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      const data = (await res.json()) as AuthMeResponse;
      cachedAuthMe = data;
      return data;
    } catch {
      cachedAuthMe = { user: null };
      return cachedAuthMe;
    }
  })();

  try {
    return await inFlightAuthMe;
  } finally {
    inFlightAuthMe = null;
  }
}

export function useAuthMe() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (options?: { force?: boolean }): Promise<AuthMeResponse> => {
    const data = await fetchAuthMe(options);
    setMe(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const intervalId = window.setInterval(() => {
      void refresh();
    }, AUTH_REFRESH_INTERVAL_MS);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return { me, loading, refresh };
}
