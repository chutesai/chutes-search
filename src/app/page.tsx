import ChatWindow from '@/components/ChatWindow';
import { ChatProvider, useChat } from '@/lib/hooks/useChat';
import { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Chat - Chutes Search',
  description: 'Chat with the internet via Chutes LLMs.',
};

const Home = () => {
  return (
    <div>
      <Suspense>
        <ChatProvider>
          <HomeContent />
        </ChatProvider>
      </Suspense>
    </div>
  );
};

const HomeContent = () => {
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
      <ChatWindow />
    </>
  );
};

export default Home;
