'use client';

import ChatWindow from '@/components/ChatWindow';
import { ChatProvider } from '@/lib/hooks/useChat';
import { Suspense } from 'react';
import Header from './Header';

const HomeContent = () => {
  return (
    <div>
      <Suspense>
        <ChatProvider>
          <div>
            <Header />
            <ChatWindow />
          </div>
        </ChatProvider>
      </Suspense>
    </div>
  );
};

export default HomeContent;
