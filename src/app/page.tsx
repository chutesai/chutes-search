import ChatWindow from '@/components/ChatWindow';
import { ChatProvider } from '@/lib/hooks/useChat';
import { Metadata } from 'next';
import { Suspense } from 'react';
import Header from '@/app/components/Header';

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
  return (
    <>
      <Header />
      <ChatWindow />
    </>
  );
};

export default Home;
