'use client';

import EmptyChatMessageInput from './EmptyChatMessageInput';
import WeatherWidget from './WeatherWidget';
import NewsArticleWidget from './NewsArticleWidget';
import UserAvatarMenu from '@/components/auth/UserAvatarMenu';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const EmptyChat = () => {
  const [inputFocused, setInputFocused] = useState(false);

  return (
    <div
      className={cn(
        'flex flex-col min-h-[100dvh] max-w-screen-md mx-auto px-2 pt-6 pb-28',
        inputFocused ? 'pb-6' : '',
      )}
    >
      <div className="flex flex-row items-center justify-between w-full">
        <div className="flex items-center gap-3">
          <img src="/chutes-logo.svg" alt="Chutes" className="h-8 w-auto" />
          <h1 className="text-2xl font-semibold">Chutes Search</h1>
        </div>
        <UserAvatarMenu />
      </div>

      <div
        className={cn(
          'flex flex-col items-center flex-1 w-full',
          inputFocused ? 'justify-start pt-8 space-y-4' : 'justify-center space-y-8',
        )}
      >
        <EmptyChatMessageInput onFocusChange={setInputFocused} />
      </div>

      <div
        data-empty-chat-widgets
        className={cn(
          'flex flex-col w-full gap-4 mt-6 sm:flex-row sm:justify-center',
          inputFocused ? 'hidden sm:flex' : '',
        )}
      >
        <div className="flex-1 w-full">
          <WeatherWidget />
        </div>
        <div className="flex-1 w-full">
          <NewsArticleWidget />
        </div>
      </div>
    </div>
  );
};

export default EmptyChat;
