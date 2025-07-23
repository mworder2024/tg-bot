'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

// Telegram WebApp types
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          chat?: {
            id: number;
            type: string;
            title?: string;
            username?: string;
          };
          auth_date: number;
          hash: string;
        };
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          setText: (text: string) => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        showPopup: (params: {
          title?: string;
          message: string;
          buttons?: Array<{
            id?: string;
            type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
            text: string;
          }>;
        }, callback?: (buttonId?: string) => void) => void;
        showAlert: (message: string, callback?: () => void) => void;
        showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
      };
    };
  }
}

interface TelegramContextType {
  isInitialized: boolean;
  user: any | null;
  chat: any | null;
  mainButton: any | null;
  backButton: any | null;
  hapticFeedback: any | null;
  showPopup: (params: any, callback?: any) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
}

const TelegramContext = createContext<TelegramContextType>({
  isInitialized: false,
  user: null,
  chat: null,
  mainButton: null,
  backButton: null,
  hapticFeedback: null,
  showPopup: () => {},
  showAlert: () => {},
  showConfirm: () => {},
});

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [telegramData, setTelegramData] = useState<any>(null);

  useEffect(() => {
    const initTelegram = () => {
      if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        
        // Initialize Telegram WebApp
        tg.ready();
        tg.expand();

        // Configure main button
        tg.MainButton.color = '#6366f1'; // Indigo color
        tg.MainButton.textColor = '#ffffff';

        setTelegramData({
          user: tg.initDataUnsafe.user,
          chat: tg.initDataUnsafe.chat,
          mainButton: tg.MainButton,
          backButton: tg.BackButton,
          hapticFeedback: tg.HapticFeedback,
          showPopup: tg.showPopup.bind(tg),
          showAlert: tg.showAlert.bind(tg),
          showConfirm: tg.showConfirm.bind(tg),
        });

        setIsInitialized(true);

        // Apply Telegram theme
        document.documentElement.style.setProperty(
          '--telegram-bg-color',
          '#1e1b4b' // Dark purple to match our theme
        );
      } else {
        // Not in Telegram, but still mark as initialized for web fallback
        setIsInitialized(true);
      }
    };

    // Check if script is already loaded
    if (window.Telegram?.WebApp) {
      initTelegram();
    } else {
      // Wait for Telegram script to load
      const checkTelegram = setInterval(() => {
        if (window.Telegram?.WebApp) {
          clearInterval(checkTelegram);
          initTelegram();
        }
      }, 100);

      // Fallback timeout
      setTimeout(() => {
        clearInterval(checkTelegram);
        setIsInitialized(true);
      }, 3000);
    }
  }, []);

  const contextValue: TelegramContextType = {
    isInitialized,
    user: telegramData?.user || null,
    chat: telegramData?.chat || null,
    mainButton: telegramData?.mainButton || null,
    backButton: telegramData?.backButton || null,
    hapticFeedback: telegramData?.hapticFeedback || null,
    showPopup: telegramData?.showPopup || (() => {}),
    showAlert: telegramData?.showAlert || ((msg: string) => alert(msg)),
    showConfirm: telegramData?.showConfirm || ((msg: string, cb?: any) => cb?.(confirm(msg))),
  };

  return (
    <TelegramContext.Provider value={contextValue}>
      {children}
    </TelegramContext.Provider>
  );
}

export const useTelegram = () => {
  const context = useContext(TelegramContext);
  if (!context) {
    throw new Error('useTelegram must be used within a TelegramProvider');
  }
  return context;
};