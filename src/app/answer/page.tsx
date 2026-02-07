import HomeContent from '@/app/components/HomeContent';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Answer - Chutes Search',
  description: 'Get an answer from the internet via Chutes LLMs.',
};

const AnswerPage = () => {
  return <HomeContent />;
};

export default AnswerPage;

