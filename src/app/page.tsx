import HomeContent from '@/app/components/HomeContent';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat - Chutes Search',
  description: 'Chat with the internet via Chutes LLMs.',
};

const Home = () => {
  return <HomeContent />;
};

export default Home;
