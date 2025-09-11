'use client';

import { useChat } from '@/lib/hooks/useChat';
import { Settings } from 'lucide-react';
import Link from 'next/link';

const Header = () => {
  const { messages, loading } = useChat();
  const shouldShowHeader = messages.length === 0 && !loading;

  return (
    <>
      {shouldShowHeader && (
        <div className="relative">
          {/* Settings icon in top right corner - only on small screens */}
          <div className="absolute right-0 top-0 pt-8 lg:hidden">
            <Link href="/settings">
              <Settings className="cursor-pointer w-6 h-6 text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white transition-colors" />
            </Link>
          </div>

          {/* Main header content */}
          <div className="flex items-center gap-3 mb-4 pt-8">
            <img src="/chutes-logo.svg" alt="Chutes" className="h-10 w-auto" />
            <h1 className="text-2xl font-semibold">Chutes Search</h1>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;


