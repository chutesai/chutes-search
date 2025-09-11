'use client';

import { useChat } from '@/lib/hooks/useChat';

const Header = () => {
  const { messages, loading } = useChat();
  const shouldShowHeader = messages.length === 0 && !loading;

  return (
    <>
      {shouldShowHeader && (
        <div className="hidden sm:flex items-center gap-3 mb-4 pt-8">
          <img src="/chutes-logo.svg" alt="Chutes" className="h-10 w-auto" />
          <h1 className="text-2xl font-semibold">Chutes Search</h1>
        </div>
      )}
    </>
  );
};

export default Header;

