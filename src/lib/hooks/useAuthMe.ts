'use client';

import { useCallback, useEffect, useState } from 'react';

export type AuthMeResponse = {
  user: { id: string; username: string | null } | null;
  scope?: string | null;
  hasInvoke?: boolean;
};

export function useAuthMe() {
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<AuthMeResponse> => {
    let data: AuthMeResponse = { user: null };
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      data = (await res.json()) as AuthMeResponse;
    } catch {
      data = { user: null };
    }

    setMe(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      refresh();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return { me, loading, refresh };
}

