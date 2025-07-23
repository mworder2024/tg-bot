import { Router } from 'express';
import { sign, verify } from 'jsonwebtoken';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const router = Router();

// Simple SIWS challenge endpoint
router.post('/challenge', async (req, res) => {
  try {
    const { publicKey } = req.body;
    
    if (!publicKey) {
      return res.status(400).json({ error: 'Public key required' });
    }

    // Generate random challenge
    const challenge = Math.random().toString(36).substring(2, 15);
    
    res.json({ challenge });
  } catch (error) {
    console.error('Challenge generation error:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Simple SIWS verification endpoint
router.post('/verify', async (req, res) => {
  try {
    const { message, signature, publicKey } = req.body;
    
    if (!message || !signature || !publicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify signature
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = new PublicKey(publicKey).toBytes();
    
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Generate JWT token
    const token = sign(
      { publicKey, timestamp: Date.now() },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '24h' }
    );

    res.json({ token, success: true });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Token refresh endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const decoded = verify(token, process.env.JWT_SECRET || 'dev-secret') as any;
    
    const newToken = sign(
      { publicKey: decoded.publicKey, timestamp: Date.now() },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '24h' }
    );

    res.json({ token: newToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;