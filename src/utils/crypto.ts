import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Encrypt a private key with a password
 */
export function encryptPrivateKey(privateKey: string, password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(16);
  
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return salt:iv:encrypted as base64
  const combined = Buffer.concat([
    salt,
    iv,
    Buffer.from(encrypted, 'hex')
  ]);
  
  return combined.toString('base64');
}

/**
 * Decrypt a private key with a password
 */
export function decryptPrivateKey(encryptedKey: string, password: string): string {
  const combined = Buffer.from(encryptedKey, 'base64');
  
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 32);
  const encrypted = combined.slice(32);
  
  const key = scryptSync(password, salt, 32);
  
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a random string for tokens
 */
export function generateRandomString(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length)
    .toUpperCase();
}