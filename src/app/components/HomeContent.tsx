'use client';

import ChatWindow from '@/components/ChatWindow';
import { ChatProvider } from '@/lib/hooks/useChat';
import { Suspense } from 'react';

const HomeContent = () => {
  return (
    <div>
      <Suspense>
        <ChatProvider>
          <div>
            <ChatWindow />
          </div>
        </ChatProvider>
      </Suspense>
    </div>
  );
};

export default HomeContent;


