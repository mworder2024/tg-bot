'use client';

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { toast } from 'react-hot-toast';
import bs58 from 'bs58';

interface SIWSAuthProps {
  onSuccess: () => void;
}

export function SIWSAuth({ onSuccess }: SIWSAuthProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { publicKey, signMessage } = useWallet();

  const handleSignIn = async () => {
    if (!publicKey || !signMessage) {
      toast.error('Wallet not connected');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Request challenge from backend
      const challengeResponse = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: publicKey.toString() }),
      });

      if (!challengeResponse.ok) {
        throw new Error('Failed to get challenge');
      }

      const { challenge } = await challengeResponse.json();

      // 2. Create SIWS message
      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = 'Sign in to Solana Lottery PWA';
      const timestamp = new Date().toISOString();

      const message = `${domain} wants you to sign in with your Solana account:
${publicKey.toString()}

${statement}

URI: ${origin}
Version: 1
Chain ID: solana:mainnet
Nonce: ${challenge}
Issued At: ${timestamp}`;

      // 3. Sign the message
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);

      // 4. Verify signature with backend
      const verifyResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          signature: bs58.encode(signature),
          publicKey: publicKey.toString(),
        }),
      });

      if (!verifyResponse.ok) {
        throw new Error('Signature verification failed');
      }

      const { token } = await verifyResponse.json();

      // 5. Store token and notify success
      localStorage.setItem('siws-token', token);
      toast.success('Successfully signed in!');
      onSuccess();

    } catch (error) {
      console.error('SIWS authentication error:', error);
      toast.error('Sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="text-center">
      <button
        onClick={handleSignIn}
        disabled={isLoading || !publicKey}
        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
      >
        {isLoading ? (
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Signing In...</span>
          </div>
        ) : (
          'Sign In with Solana'
        )}
      </button>
      
      <p className="text-sm text-gray-400 mt-3">
        This will prompt you to sign a message with your wallet
      </p>
    </div>
  );
}