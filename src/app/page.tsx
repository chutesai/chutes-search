import ChatWindow from '@/components/ChatWindow';
import { ChatProvider } from '@/lib/hooks/useChat';
import { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Chat - Chutes Search',
  description: 'Chat with the internet via Chutes LLMs.',
};

const Home = () => {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4 mt-4">
        <img src="/chutes-logo.svg" alt="Chutes" className="h-8 w-auto" />
        <h1 className="text-xl font-semibold">Chutes Search</h1>
      </div>
      <Suspense>
        <ChatProvider>
          <ChatWindow />
        </ChatProvider>
      </Suspense>
    </div>
  );
};

export default Home;
