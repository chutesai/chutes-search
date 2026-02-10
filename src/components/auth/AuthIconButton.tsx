'use client';

import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';

type MeResponse = {
  user: { id: string; username: string | null } | null;
};

export default function AuthIconButton() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [returnTo, setReturnTo] = useState<string>('/');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = (await res.json()) as MeResponse;
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) setMe({ user: null });
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setReturnTo(window.location.pathname + window.location.search);
  }, []);

  const href = me?.user
    ? `/api/auth/logout?returnTo=/`
    : `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

  const title = me?.user ? 'Sign out' : 'Sign in with Chutes';
  const Icon = me?.user ? LogOut : LogIn;

  return (
    <a
      href={href}
      title={title}
      className="relative flex flex-row items-center justify-center cursor-pointer hover:bg-black/10 dark:hover:bg-white/10 duration-150 transition w-full py-2 rounded-lg text-black/70 dark:text-white/70"
    >
      <Icon />
    </a>
  );
}
