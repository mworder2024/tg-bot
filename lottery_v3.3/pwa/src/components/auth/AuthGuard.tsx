'use client';

import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useTelegram } from '@/hooks/useTelegram';
import { useDiscord } from '@/hooks/useDiscord';
import { SIWSAuth } from './SIWSAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface AuthGuardProps {
  children: React.ReactNode;
  platform: 'web' | 'telegram' | 'discord';
}

export function AuthGuard({ children, platform }: AuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const { connected: walletConnected, publicKey } = useWallet();
  const { isInitialized: telegramReady, user: telegramUser } = useTelegram();
  const { isReady: discordReady, user: discordUser, authenticate: discordAuth } = useDiscord();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        switch (platform) {
          case 'telegram':
            // Telegram Mini App authentication
            if (telegramReady && telegramUser) {
              setIsAuthenticated(true);
            } else if (telegramReady && !telegramUser) {
              setAuthError('Telegram user not found. Please restart the app.');
            }
            break;

          case 'discord':
            // Discord Activity authentication
            if (discordReady) {
              if (!discordUser) {
                try {
                  await discordAuth();
                  setIsAuthenticated(true);
                } catch (error) {
                  setAuthError('Discord authentication failed. Please try again.');
                }
              } else {
                setIsAuthenticated(true);
              }
            }
            break;

          case 'web':
          default:
            // Web requires wallet connection + SIWS
            if (walletConnected && publicKey) {
              // Check if SIWS authentication is completed
              const siwsToken = localStorage.getItem('siws-token');
              if (siwsToken) {
                // Verify token validity
                try {
                  const payload = JSON.parse(atob(siwsToken.split('.')[1]));
                  if (payload.exp > Date.now() / 1000) {
                    setIsAuthenticated(true);
                  }
                } catch {
                  localStorage.removeItem('siws-token');
                }
              }
            }
            break;
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        setAuthError('Authentication failed. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [platform, walletConnected, publicKey, telegramReady, telegramUser, discordReady, discordUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8 bg-red-900/20 rounded-lg border border-red-500">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Authentication Error</h2>
          <p className="text-red-300 mb-6">{authError}</p>
          <button
            onClick={() => {
              setAuthError(null);
              setIsLoading(true);
            }}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center p-8 bg-gray-900/20 rounded-lg border border-gray-500">
          <h2 className="text-2xl font-bold text-white mb-6">Authentication Required</h2>
          
          {platform === 'web' && (
            <div className="space-y-4">
              <p className="text-gray-300 mb-4">
                Connect your Solana wallet and sign in to continue
              </p>
              {!walletConnected ? (
                <WalletMultiButton className="bg-purple-600 hover:bg-purple-700" />
              ) : (
                <SIWSAuth onSuccess={() => setIsAuthenticated(true)} />
              )}
            </div>
          )}

          {platform === 'telegram' && (
            <div>
              <p className="text-gray-300">
                Please restart the Telegram Mini App to authenticate
              </p>
            </div>
          )}

          {platform === 'discord' && (
            <div>
              <p className="text-gray-300 mb-4">
                Discord authentication is required to continue
              </p>
              <button
                onClick={async () => {
                  try {
                    await discordAuth();
                    setIsAuthenticated(true);
                  } catch (error) {
                    setAuthError('Discord authentication failed');
                  }
                }}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                Authenticate with Discord
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}