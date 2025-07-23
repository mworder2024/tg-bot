'use client';

import { useEffect, useState } from 'react';
import { useTelegram } from '@/hooks/useTelegram';
import { useDiscord } from '@/hooks/useDiscord';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { GameBoard } from '@/components/game/GameBoard';
import { PlatformDetector } from '@/components/platform/PlatformDetector';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(true);
  const [platform, setPlatform] = useState<'web' | 'telegram' | 'discord'>('web');
  
  const { isInitialized: telegramReady, user: telegramUser } = useTelegram();
  const { isReady: discordReady, user: discordUser } = useDiscord();
  const { connected: walletConnected } = useWallet();

  useEffect(() => {
    // Detect platform and initialize
    const detectPlatform = async () => {
      if (window.Telegram?.WebApp) {
        setPlatform('telegram');
      } else if (window.DiscordSDK) {
        setPlatform('discord');
      } else {
        setPlatform('web');
      }
      
      // Wait for platform initialization
      await new Promise(resolve => setTimeout(resolve, 1000));
      setIsLoading(false);
    };

    detectPlatform();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <PlatformDetector platform={platform} />
      
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">
            🎲 Solana Lottery PWA
          </h1>
          <p className="text-lg text-purple-200">
            Play verifiable lottery games on Telegram, Discord, or Web
          </p>
        </header>

        <AuthGuard platform={platform}>
          <div className="max-w-4xl mx-auto">
            {/* Platform-specific UI */}
            {platform === 'web' && (
              <div className="mb-6 text-center">
                <WalletMultiButton className="bg-purple-600 hover:bg-purple-700" />
              </div>
            )}

            {/* Game Interface */}
            <GameBoard platform={platform} />

            {/* Platform Info */}
            <div className="mt-8 p-4 bg-black/20 rounded-lg text-center">
              <p className="text-purple-200">
                Platform: <span className="font-semibold text-white">{platform}</span>
              </p>
              {platform === 'telegram' && telegramUser && (
                <p className="text-purple-200">
                  Welcome, {telegramUser.first_name}! 👋
                </p>
              )}
              {platform === 'discord' && discordUser && (
                <p className="text-purple-200">
                  Welcome, {discordUser.username}! 🎮
                </p>
              )}
              {platform === 'web' && walletConnected && (
                <p className="text-green-400 text-sm mt-2">
                  Wallet Connected ✅
                </p>
              )}
            </div>
          </div>
        </AuthGuard>
      </div>
    </main>
  );
}