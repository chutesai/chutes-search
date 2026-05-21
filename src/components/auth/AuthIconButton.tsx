'use client';

import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { useAuthMe } from '@/lib/hooks/useAuthMe';

export default function AuthIconButton() {
  const { me } = useAuthMe();
  const [returnTo, setReturnTo] = useState<string>('/');

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
