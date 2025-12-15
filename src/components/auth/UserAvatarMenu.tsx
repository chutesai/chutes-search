'use client';

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { LogIn, LogOut } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuthMe } from '@/lib/hooks/useAuthMe';
import { cn } from '@/lib/utils';

function getAvatarLabel(params: { username: string | null | undefined; id: string }) {
  const username = params.username?.trim();
  if (username) return username[0]?.toUpperCase() || 'U';
  return params.id.slice(0, 1).toUpperCase();
}

export default function UserAvatarMenu({ className }: { className?: string }) {
  const { me, loading } = useAuthMe();
  const [returnTo, setReturnTo] = useState('/');

  useEffect(() => {
    setReturnTo(window.location.pathname + window.location.search);
  }, []);

  const loginHref = useMemo(
    () => `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );
  const logoutHref = useMemo(
    () => `/api/auth/logout?returnTo=${encodeURIComponent(returnTo)}`,
    [returnTo],
  );

  const isSignedIn = Boolean(me?.user);
  const username = me?.user?.username || null;
  const userId = me?.user?.id || 'user';

  if (loading) {
    return (
      <div
        className={cn(
          'h-9 w-9 rounded-full bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200 animate-pulse',
          className,
        )}
      />
    );
  }

  if (!isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => {
          window.location.href = loginHref;
        }}
        title="Sign in with Chutes"
        className={cn(
          'h-9 w-9 rounded-full bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200',
          'inline-flex items-center justify-center text-black/70 dark:text-white/70',
          'hover:bg-light-200 dark:hover:bg-dark-200 transition-colors',
          className,
        )}
      >
        <LogIn size={18} />
      </button>
    );
  }

  const avatarLabel = getAvatarLabel({ username, id: userId });
  const displayName = username || `user:${userId.slice(0, 6)}`;

  return (
    <Menu as="div" className={cn('relative', className)}>
      <MenuButton
        className={cn(
          'h-9 w-9 rounded-full bg-light-secondary dark:bg-dark-secondary border border-light-200 dark:border-dark-200',
          'inline-flex items-center justify-center text-sm font-semibold text-black dark:text-white',
          'hover:bg-light-200 dark:hover:bg-dark-200 transition-colors',
        )}
        aria-label="Account menu"
      >
        {avatarLabel}
      </MenuButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <MenuItems className="absolute right-0 mt-2 w-56 origin-top-right rounded-xl shadow-xl bg-light-primary dark:bg-dark-primary border border-light-200 dark:border-dark-200 z-50 p-1 focus:outline-none">
          <div className="px-3 py-2">
            <p className="text-xs text-black/60 dark:text-white/60">Signed in as</p>
            <p className="text-sm font-medium text-black dark:text-white truncate">
              {displayName}
            </p>
          </div>
          <div className="h-px bg-light-200 dark:bg-dark-200 my-1" />
          <MenuItem>
            {({ active }) => (
              <button
                type="button"
                onClick={() => {
                  window.location.href = logoutHref;
                }}
                className={cn(
                  'w-full px-3 py-2 rounded-lg text-left text-sm flex items-center gap-2',
                  active
                    ? 'bg-light-secondary dark:bg-dark-secondary text-black dark:text-white'
                    : 'text-black/80 dark:text-white/80',
                )}
              >
                <LogOut size={16} className="text-black/70 dark:text-white/70" />
                Sign out
              </button>
            )}
          </MenuItem>
        </MenuItems>
      </Transition>
    </Menu>
  );
}

