'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

// Discord SDK types
declare global {
  interface Window {
    DiscordSDK?: {
      ready: () => Promise<void>;
      authorize: (options: any) => Promise<any>;
      authenticate: (options: any) => Promise<any>;
      subscribe: (event: string, callback: (data: any) => void) => () => void;
      unsubscribe: (event: string, callback: (data: any) => void) => void;
      commands: {
        encourage: (options: any) => Promise<void>;
        setActivity: (activity: any) => Promise<void>;
      };
    };
  }
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

interface DiscordContextType {
  isReady: boolean;
  user: DiscordUser | null;
  guildId: string | null;
  channelId: string | null;
  authenticate: () => Promise<void>;
  setActivity: (activity: any) => Promise<void>;
  encourage: (userId: string) => Promise<void>;
}

const DiscordContext = createContext<DiscordContextType>({
  isReady: false,
  user: null,
  guildId: null,
  channelId: null,
  authenticate: async () => {},
  setActivity: async () => {},
  encourage: async () => {},
});

export function DiscordProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  useEffect(() => {
    const initDiscord = async () => {
      if (window.DiscordSDK) {
        try {
          await window.DiscordSDK.ready();
          
          // Get activity instance info
          const instanceInfo = await window.DiscordSDK.commands.setActivity({
            activity: {
              type: 0, // Playing
              details: 'Solana Lottery',
              state: 'Waiting to play',
              assets: {
                large_image: 'lottery_logo',
                large_text: 'Solana Lottery PWA',
              },
              buttons: [
                {
                  label: 'Join Game',
                  url: process.env.NEXT_PUBLIC_APP_URL || 'https://lottery.example.com',
                },
              ],
            },
          });

          setIsReady(true);
        } catch (error) {
          console.error('Discord SDK initialization failed:', error);
          // Still mark as ready for web fallback
          setIsReady(true);
        }
      } else {
        // Not in Discord environment
        setIsReady(true);
      }
    };

    initDiscord();
  }, []);

  const authenticate = async () => {
    if (!window.DiscordSDK) {
      throw new Error('Discord SDK not available');
    }

    try {
      const { code } = await window.DiscordSDK.authorize({
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds'],
      });

      const response = await window.DiscordSDK.authenticate({
        access_token: code,
      });

      setUser(response.user);
      setGuildId(response.guild_id);
      setChannelId(response.channel_id);
    } catch (error) {
      console.error('Discord authentication failed:', error);
      throw error;
    }
  };

  const setActivity = async (activity: any) => {
    if (window.DiscordSDK?.commands.setActivity) {
      await window.DiscordSDK.commands.setActivity({ activity });
    }
  };

  const encourage = async (userId: string) => {
    if (window.DiscordSDK?.commands.encourage) {
      await window.DiscordSDK.commands.encourage({ user_id: userId });
    }
  };

  const contextValue: DiscordContextType = {
    isReady,
    user,
    guildId,
    channelId,
    authenticate,
    setActivity,
    encourage,
  };

  return (
    <DiscordContext.Provider value={contextValue}>
      {children}
    </DiscordContext.Provider>
  );
}

export const useDiscord = () => {
  const context = useContext(DiscordContext);
  if (!context) {
    throw new Error('useDiscord must be used within a DiscordProvider');
  }
  return context;
};