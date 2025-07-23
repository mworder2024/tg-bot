import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { WalletProvider } from '@/components/providers/WalletProvider';
import { TelegramProvider } from '@/components/providers/TelegramProvider';
import { DiscordProvider } from '@/components/providers/DiscordProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ApolloProvider } from '@/components/providers/ApolloProvider';
import { Toast } from '@/components/ui/Toast';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Solana Lottery - Multi-Platform PWA',
  description: 'Play Solana-powered lottery games on Telegram, Discord, and Web',
  manifest: '/manifest.json',
  themeColor: '#000000',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
  icons: {
    icon: '/icon-192x192.png',
    apple: '/icon-192x192.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Solana Lottery" />
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
      </head>
      <body className={inter.className}>
        <QueryProvider>
          <ApolloProvider>
            <WalletProvider>
              <TelegramProvider>
                <DiscordProvider>
                  {children}
                  <Toast />
                </DiscordProvider>
              </TelegramProvider>
            </WalletProvider>
          </ApolloProvider>
        </QueryProvider>
      </body>
    </html>
  );
}