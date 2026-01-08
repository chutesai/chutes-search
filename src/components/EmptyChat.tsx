'use client';

import EmptyChatMessageInput from './EmptyChatMessageInput';
import WeatherWidget from './WeatherWidget';
import NewsArticleWidget from './NewsArticleWidget';
import UserAvatarMenu from '@/components/auth/UserAvatarMenu';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useChat } from '@/lib/hooks/useChat';
import { Compass, Feather, Microscope } from 'lucide-react';

const EmptyChat = () => {
  const [inputFocused, setInputFocused] = useState(false);
  const { focusMode, setFocusMode } = useChat();

  const quickModes = [
    {
      key: 'deepResearch',
      title: 'Deep Research',
      description: 'Live browsing with citations and summaries.',
      icon: <Microscope className="h-4 w-4" />,
    },
    {
      key: 'academicSearch',
      title: 'Academic',
      description: 'Peer-reviewed papers and scholarly sources.',
      icon: <Compass className="h-4 w-4" />,
    },
    {
      key: 'writingAssistant',
      title: 'Writing',
      description: 'Drafts, rewrites, and idea exploration.',
      icon: <Feather className="h-4 w-4" />,
    },
  ];

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
        <div className={cn('w-full', inputFocused ? 'hidden sm:block' : '')}>
          <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-gradient-to-br from-[#eef7ff] via-white to-[#f7f2ff] dark:from-[#0f1620] dark:via-[#0a0a0a] dark:to-[#0e1a22] p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-black/50 dark:text-white/40">
              Deep research workspace
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-black dark:text-white">
              Research begins here.
            </h2>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              Use Deep Research when you need a multi-source report. Switch modes anytime to balance speed and depth.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {quickModes.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setFocusMode(mode.key)}
                  className={cn(
                    'flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition duration-200',
                    focusMode === mode.key
                      ? 'border-[#24A0ED] bg-[#24A0ED]/10 text-[#0b66a8] dark:text-[#9fd3ff]'
                      : 'border-light-200 dark:border-dark-200 bg-white/70 dark:bg-dark-200/30 text-black/70 dark:text-white/70 hover:border-[#24A0ED]/60 hover:text-black dark:hover:text-white',
                  )}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                    {mode.icon}
                    {mode.title}
                  </div>
                  <p className="text-xs leading-snug">{mode.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
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
