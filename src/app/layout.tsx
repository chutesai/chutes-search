import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import Sidebar from '@/components/Sidebar';
import { Toaster } from 'sonner';
import ThemeProvider from '@/components/theme/Provider';

const montserrat = Montserrat({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Chutes Search - Chat with the internet',
  description:
    'Chutes Search is an AI-powered search engine using Chutes LLMs with web browsing.',
  icons: {
    icon: 'https://chutes.ai/favicon.png',
    shortcut: 'https://chutes.ai/favicon.png',
    apple: 'https://chutes.ai/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="h-full" lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="https://chutes.ai/favicon.png" type="image/png" />
        <link rel="shortcut icon" href="https://chutes.ai/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="https://chutes.ai/favicon.png" />
      </head>
      <body className={cn('h-full', montserrat.className)}>
        <ThemeProvider>
          <Sidebar>{children}</Sidebar>
          <Toaster
            toastOptions={{
              unstyled: true,
              classNames: {
                toast:
                  'bg-light-primary dark:bg-dark-secondary dark:text-white/70 text-black-70 rounded-lg p-4 flex flex-row items-center space-x-2',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
