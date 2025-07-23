'use client';

import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useTelegram } from '@/hooks/useTelegram';
import { useDiscord } from '@/hooks/useDiscord';
import { CreateGameForm } from './CreateGameForm';
import { JoinGameForm } from './JoinGameForm';
import { GameView } from './GameView';
import { GameList } from './GameList';

interface GameBoardProps {
  platform: 'web' | 'telegram' | 'discord';
}

interface Game {
  id: string;
  status: 'waiting' | 'active' | 'completed';
  entryFee: number;
  currentPlayers: number;
  maxPlayers: number;
  creator: string;
  createdAt: string;
}

export function GameBoard({ platform }: GameBoardProps) {
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'join' | 'game'>('list');
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { publicKey } = useWallet();
  const { user: telegramUser, mainButton, hapticFeedback } = useTelegram();
  const { user: discordUser, setActivity } = useDiscord();

  useEffect(() => {
    loadGames();
  }, []);

  // Update platform-specific UI
  useEffect(() => {
    if (platform === 'telegram' && mainButton) {
      switch (currentView) {
        case 'list':
          mainButton.setText('Create Game');
          mainButton.onClick(() => setCurrentView('create'));
          mainButton.show();
          break;
        case 'create':
          mainButton.setText('Back to Games');
          mainButton.onClick(() => setCurrentView('list'));
          break;
        default:
          mainButton.hide();
      }
    }

    if (platform === 'discord' && discordUser) {
      setActivity({
        type: 0,
        details: getActivityDetails(),
        state: getActivityState(),
        assets: {
          large_image: 'lottery_logo',
          large_text: 'Solana Lottery PWA',
        },
      });
    }
  }, [currentView, platform, mainButton, setActivity, discordUser]);

  const loadGames = async () => {
    setIsLoading(true);
    try {
      // This would connect to your GraphQL API
      const response = await fetch('/api/games');
      if (response.ok) {
        const gamesData = await response.json();
        setGames(gamesData);
      }
    } catch (error) {
      console.error('Failed to load games:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getActivityDetails = () => {
    switch (currentView) {
      case 'create': return 'Creating new lottery';
      case 'join': return 'Joining lottery game';
      case 'game': return 'Playing lottery';
      default: return 'Browsing lottery games';
    }
  };

  const getActivityState = () => {
    if (selectedGame) {
      return `Game ${selectedGame.id}`;
    }
    return `${games.length} active games`;
  };

  const handleCreateGame = async (gameData: any) => {
    try {
      if (platform === 'telegram' && hapticFeedback) {
        hapticFeedback.impactOccurred('medium');
      }

      // Create game via blockchain
      const response = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gameData),
      });

      if (response.ok) {
        const newGame = await response.json();
        setGames(prev => [newGame, ...prev]);
        setCurrentView('list');
        
        if (platform === 'telegram' && hapticFeedback) {
          hapticFeedback.notificationOccurred('success');
        }
      }
    } catch (error) {
      console.error('Failed to create game:', error);
      if (platform === 'telegram' && hapticFeedback) {
        hapticFeedback.notificationOccurred('error');
      }
    }
  };

  const handleJoinGame = async (gameId: string) => {
    try {
      if (platform === 'telegram' && hapticFeedback) {
        hapticFeedback.impactOccurred('medium');
      }

      const response = await fetch(`/api/games/${gameId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: publicKey?.toString(),
          telegramId: telegramUser?.id?.toString(),
          discordId: discordUser?.id,
        }),
      });

      if (response.ok) {
        await loadGames();
        
        if (platform === 'telegram' && hapticFeedback) {
          hapticFeedback.notificationOccurred('success');
        }
      }
    } catch (error) {
      console.error('Failed to join game:', error);
      if (platform === 'telegram' && hapticFeedback) {
        hapticFeedback.notificationOccurred('error');
      }
    }
  };

  if (isLoading && games.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-purple-200">Loading games...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navigation */}
      {platform !== 'telegram' && (
        <nav className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={() => setCurrentView('list')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              currentView === 'list'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-900/50 text-purple-200 hover:bg-purple-800/50'
            }`}
          >
            Games
          </button>
          <button
            onClick={() => setCurrentView('create')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              currentView === 'create'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-900/50 text-purple-200 hover:bg-purple-800/50'
            }`}
          >
            Create
          </button>
        </nav>
      )}

      {/* Content */}
      <div className="bg-black/20 rounded-lg p-6 border border-purple-500/20">
        {currentView === 'list' && (
          <GameList
            games={games}
            onJoinGame={handleJoinGame}
            onSelectGame={(game) => {
              setSelectedGame(game);
              setCurrentView('game');
            }}
            platform={platform}
          />
        )}

        {currentView === 'create' && (
          <CreateGameForm
            onCreateGame={handleCreateGame}
            onCancel={() => setCurrentView('list')}
            platform={platform}
          />
        )}

        {currentView === 'game' && selectedGame && (
          <GameView
            game={selectedGame}
            onBack={() => setCurrentView('list')}
            platform={platform}
          />
        )}
      </div>

      {/* Platform-specific UI hints */}
      {platform === 'telegram' && (
        <div className="text-center text-sm text-purple-300">
          💡 Use the button below to navigate
        </div>
      )}

      {platform === 'discord' && (
        <div className="text-center text-sm text-purple-300">
          🎮 Your Discord status shows your current activity
        </div>
      )}
    </div>
  );
}