# Mainnet Deployment Guide

## 🚀 Quick Start

### Prerequisites
1. **Wallet with SOL**: You need ~2 SOL for deployment (1.5 SOL rent + fees)
2. **Anchor CLI**: `cargo install --git https://github.com/coral-xyz/anchor anchor-cli`
3. **Solana CLI**: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
4. **Node.js**: Version 18+ installed

### Step 1: Configure Mainnet Wallet

```bash
# Set your mainnet wallet (if not already set)
solana config set --keypair ~/.config/solana/mainnet.json
solana config set --url https://api.mainnet-beta.solana.com

# Check balance
solana balance
```

### Step 2: Update Environment Variables

Create `.env.mainnet` with:
```bash
# Copy from .env.example and update:
MAINNET_WALLET_PATH=/path/to/your/mainnet-wallet.json
MAINNET_RPC_URL=https://api.mainnet-beta.solana.com

# IMPORTANT: For initial test, using SOL as token
# Replace with actual MWOR token mint on mainnet
MWOR_TOKEN_MINT_MAINNET=So11111111111111111111111111111111111111112

# Optional: Set treasury authority (defaults to deployer)
TREASURY_AUTHORITY_MAINNET=<your-treasury-wallet-pubkey>

# Optional: VRF Oracle (defaults to deployer for testing)
VRF_ORACLE_MAINNET=<vrf-oracle-pubkey>
```

### Step 3: Deploy to Mainnet

```bash
# Build the program first
npm run build:program

# Deploy to mainnet (will show warnings and confirmations)
npm run deploy:mainnet
```

This will:
- Build the program
- Calculate rent costs
- Deploy to mainnet
- Initialize the program
- Save deployment info to `deployments/mainnet.json`
- Create `.env.mainnet` with all addresses

### Step 4: Verify Deployment

```bash
# Run mainnet tests
npm run test:mainnet
```

This creates a small test game and verifies the deployment.

## 📊 Deployment Costs

- **Program Deployment**: ~1.5 SOL (rent-exempt, recoverable)
- **Transaction Fee**: ~0.01 SOL
- **Total**: ~1.51 SOL

## 🔧 Configuration

### Using Real MWOR Token

Once you have the MWOR token mint address:

1. Update `.env.mainnet`:
```bash
MWOR_TOKEN_MINT_MAINNET=<actual-mwor-mint-address>
```

2. Redeploy or update configuration

### Production RPC

For production, use a dedicated RPC:
```bash
MAINNET_RPC_URL=https://your-rpc-provider.com
```

Recommended providers:
- QuickNode
- Alchemy
- Helius
- Triton

## 🎮 Testing on Mainnet

### Create Test Game (using SOL)

```typescript
// In your bot or test script
const gameConfig = {
  gameId: `mainnet-${Date.now()}`,
  entryFee: 0.001, // 0.001 SOL for testing
  maxPlayers: 3,
  winnerCount: 1,
  paymentDeadlineMinutes: 30,
};
```

### Join Test Game

1. Send exactly 0.001 SOL to the escrow address
2. Include the memo: `gameId:userId`
3. Wait for confirmation

## 🔍 Monitoring

### Solana Explorer

View your deployment:
```
https://explorer.solana.com/address/<PROGRAM_ID>
```

### Transaction Monitoring

Monitor all transactions:
```
https://explorer.solana.com/address/<ESCROW_PDA>
```

## ⚠️ Security Checklist

Before going live with real funds:

- [ ] Set proper treasury authority (multisig recommended)
- [ ] Configure production VRF oracle
- [ ] Set up monitoring alerts
- [ ] Test all game flows
- [ ] Implement rate limiting
- [ ] Set up emergency pause mechanism
- [ ] Configure proper RPC endpoints
- [ ] Review all PDAs and authorities

## 🚨 Emergency Procedures

### Pause New Games
Update bot to reject new game creation

### Cancel Active Games
Use the `cancel_game` instruction with authority

### Withdraw Treasury
Only treasury authority can withdraw collected fees

## 📝 Mainnet Addresses

After deployment, your addresses will be in `deployments/mainnet.json`:

```json
{
  "network": "mainnet-beta",
  "programId": "YOUR_PROGRAM_ID",
  "treasuryPDA": "YOUR_TREASURY_PDA",
  "tokenMint": "TOKEN_MINT_ADDRESS",
  "treasuryAuthority": "AUTHORITY_PUBKEY",
  "deployedAt": "2024-01-13T..."
}
```

## 🔄 Updating the Program

To update the program:

```bash
# Make changes to the program
# Build
npm run build:program

# Upgrade (keeps same program ID)
solana program deploy target/deploy/telegram_lottery.so \
  --program-id <EXISTING_PROGRAM_ID> \
  --keypair ~/.config/solana/mainnet.json \
  --url https://api.mainnet-beta.solana.com
```

## 💡 Tips

1. **Start Small**: Test with tiny amounts first
2. **Monitor Closely**: Watch the first few games carefully
3. **Have Backup RPC**: Multiple RPC endpoints for reliability
4. **Keep Logs**: Enable comprehensive logging
5. **Regular Audits**: Review treasury and escrow balances

## 🆘 Troubleshooting

### "Insufficient funds"
- Need more SOL in deployment wallet
- Each game creation costs ~0.01 SOL

### "Transaction too large"
- Break into smaller transactions
- Optimize instruction size

### "RPC error"
- Switch to different RPC endpoint
- Check rate limits

### "Account already in use"
- Program already initialized
- Check existing deployment

## 📞 Support

For issues:
1. Check transaction logs on Solana Explorer
2. Review error messages in bot logs
3. Verify all addresses match deployment info
4. Ensure wallets have sufficient balance

Remember: Mainnet transactions are irreversible. Always double-check before sending!