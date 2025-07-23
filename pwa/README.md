# Solana VRF Lottery PWA

A modern Progressive Web Application for decentralized lottery gaming on Solana, with seamless integration for Telegram and Discord mini apps.

## 🎯 Project Overview

This PWA transforms the existing Telegram lottery bot into a full-featured web application that can:
- Run as a standalone Progressive Web App
- Integrate as a Telegram Mini App
- Embed as a Discord Application
- Provide cross-platform lottery gaming with Solana blockchain integration

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 with App Router
- **UI Library**: React 18
- **Styling**: TailwindCSS + Shadcn/ui
- **PWA**: next-pwa for offline capabilities
- **State Management**: Zustand + React Query

### Backend
- **API**: GraphQL with Apollo Server
- **Database**: FaunaDB for serverless data persistence
- **Caching**: Redis for session management
- **Real-time**: GraphQL Subscriptions

### Blockchain
- **Network**: Solana Mainnet
- **Program**: Anchor/Rust (existing implementation)
- **SDK**: @solana/web3.js
- **Wallet**: Solana Wallet Adapter
- **Authentication**: Sign-In with Solana (SIWS)

### Platform Integration
- **Telegram**: Mini App SDK
- **Discord**: Embedded App SDK
- **OAuth**: Platform-specific authentication flows

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (PWA)                        │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Next.js   │  │    React     │  │  Wallet Adapter   │  │
│  │  App Router │  │  Components  │  │      (SIWS)       │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GraphQL API Gateway                        │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   Apollo    │  │   Resolvers  │  │  Subscriptions    │  │
│  │   Server    │  │   & Schema   │  │   (Real-time)     │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└────────┬───────────────────┬────────────────────┬──────────┘
         │                   │                    │
         ▼                   ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│    FaunaDB      │ │  Solana RPC     │ │  Platform APIs   │
│  (User Data)    │ │  (Blockchain)   │ │ (Telegram/Discord)│
└─────────────────┘ └─────────────────┘ └──────────────────┘
```

## 🚀 Features

### Core Features
- ✅ Decentralized VRF-based lottery system
- ✅ Solana wallet integration with multiple adapters
- ✅ Real-time game updates via subscriptions
- ✅ Cross-platform compatibility
- ✅ Offline support with service workers
- ✅ Responsive design for all devices

### Platform-Specific Features
- **Telegram Mini App**
  - Native UI components
  - Telegram authentication
  - In-app notifications
  - Payment integration

- **Discord App**
  - Embedded iframe support
  - Discord OAuth
  - Guild-specific games
  - Role-based permissions

### Security Features
- Sign-In with Solana (SIWS) for authentication
- Transaction simulation before submission
- Rate limiting and DDoS protection
- Secure session management

## 📁 Project Structure

```
pwa/
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── (auth)/            # Auth-protected routes
│   │   ├── api/               # API routes
│   │   └── page.tsx           # Home page
│   ├── components/            # React components
│   │   ├── ui/               # Base UI components
│   │   ├── lottery/          # Lottery-specific components
│   │   └── wallet/           # Wallet integration
│   ├── graphql/              # GraphQL schema & resolvers
│   │   ├── schema/           # Type definitions
│   │   ├── resolvers/        # Resolver implementations
│   │   └── datasources/      # Data layer
│   ├── lib/                  # Utilities and helpers
│   │   ├── solana/          # Blockchain utilities
│   │   ├── fauna/           # Database client
│   │   └── platforms/       # Platform integrations
│   ├── hooks/               # Custom React hooks
│   └── styles/              # Global styles
├── public/                  # Static assets
├── tests/                   # Test suites
└── next.config.js          # Next.js configuration
```

## 🔧 Development Setup

### Prerequisites
- Node.js 18+
- pnpm or npm
- Solana CLI tools
- FaunaDB account
- Redis instance (local or cloud)

### Environment Variables
```env
# Solana
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_SOLANA_PROGRAM_ID=<your-program-id>

# FaunaDB
FAUNA_SECRET_KEY=<your-fauna-secret>
FAUNA_DOMAIN=db.fauna.com

# GraphQL
GRAPHQL_ENDPOINT=http://localhost:4000/graphql

# Platform Integration
TELEGRAM_BOT_TOKEN=<your-bot-token>
DISCORD_CLIENT_ID=<your-client-id>
DISCORD_CLIENT_SECRET=<your-client-secret>

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
SIWS_DOMAIN=localhost:3000
JWT_SECRET=<your-jwt-secret>
```

### Installation
```bash
# Clone repository
git clone <repo-url>
cd telegram-lottery-bot/pwa

# Install dependencies
pnpm install

# Setup database
pnpm run db:setup

# Run development server
pnpm run dev
```

## 🧪 Testing

```bash
# Unit tests
pnpm run test

# Integration tests
pnpm run test:integration

# E2E tests
pnpm run test:e2e

# Test coverage
pnpm run test:coverage
```

## 📱 PWA Configuration

The app is configured as a PWA with:
- Service worker for offline functionality
- App manifest for installation
- Push notifications support
- Background sync for transactions

## 🔐 Security Considerations

1. **Wallet Security**: Never store private keys, use wallet adapters
2. **SIWS Authentication**: Verify signatures on backend
3. **Rate Limiting**: Implement per-user and global limits
4. **Input Validation**: Sanitize all user inputs
5. **CORS**: Configure appropriate origins

## 🚢 Deployment

### Vercel (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### Docker
```bash
# Build image
docker build -t lottery-pwa .

# Run container
docker run -p 3000:3000 lottery-pwa
```

## 📊 Monitoring

- **Performance**: Vercel Analytics / Google Analytics
- **Errors**: Sentry error tracking
- **Blockchain**: Custom Solana monitoring dashboard
- **API**: Apollo Studio for GraphQL monitoring

## 🤝 Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Resources

- [Solana Documentation](https://docs.solana.com)
- [Next.js Documentation](https://nextjs.org/docs)
- [GraphQL Best Practices](https://graphql.org/learn/best-practices/)
- [FaunaDB Documentation](https://docs.fauna.com)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Discord Developer Portal](https://discord.com/developers/docs)