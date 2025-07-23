import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatSOL(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

export function detectPlatform(): 'telegram' | 'discord' | 'web' {
  if (typeof window === 'undefined') return 'web';
  
  // Check for Telegram
  if (window.Telegram?.WebApp) {
    return 'telegram';
  }
  
  // Check for Discord (embedded iframe)
  try {
    if (window.parent !== window && window.location.ancestorOrigins?.contains('discord.com')) {
      return 'discord';
    }
  } catch (e) {
    // Cross-origin error, likely in iframe
  }
  
  return 'web';
}