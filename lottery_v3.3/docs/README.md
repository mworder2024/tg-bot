# 🎰 Decentralized Raffle Hub v4 - Complete Ecosystem

A comprehensive decentralized raffle platform featuring VRF-based trustless lotteries with Solana escrow PDAs, modern web interface, and intelligent Telegram bot integration.

## 🌟 System Overview

**v4 represents the complete evolution** of the lottery bot into a full-stack decentralized raffle ecosystem:

### Core Components
- 🔗 **Solana Programs** - Trustless VRF lottery with escrow PDAs
- 🖥️ **Backend API** - Express.js API with PostgreSQL database
- 🌐 **Frontend Hub** - Next.js raffle interface with React/TailwindCSS/shadcn/ui
- 🤖 **Telegram Bot** - Intelligent bot for announcements and ticket purchases
- 📊 **Real-time Integration** - All components communicate via API

## 🎯 Target Architecture

### Frontend "Raffle Hub" (Next.js)
- Modern React interface with TailwindCSS and shadcn/ui
- Real-time raffle browsing and participation
- Wallet connection and transaction signing
- Live raffle progress tracking
- Winner announcements and prize claiming

### Backend API & Database
- RESTful API for raffle management
- PostgreSQL database for raffle metadata
- User authentication and session management
- Payment processing and ticket validation
- Real-time WebSocket updates

### Solana Programs
- VRF-based trustless random number generation
- PDA escrow accounts for secure prize pools
- Automated prize distribution
- Transparent and verifiable draws
- Gas-efficient batch operations

### Telegram Bot Integration
- Announces new raffles with participation links
- Narrates draws in "survival" format with dramatic messaging
- Allows direct ticket purchases via bot commands
- Fetches user ticket details and prize history
- Integrates with backend API for real-time data

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Solana CLI tools
- Telegram Bot Token

### Installation
```bash
cd v4
npm install
npm run build

# Database setup
npm run db:migrate
npm run db:seed

# Start all services
npm run dev:all
```

### Configuration
```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/raffle_hub

# Solana
SOLANA_NETWORK=devnet
PROGRAM_ID=your_program_id
WALLET_KEYPAIR=path/to/keypair.json

# Telegram
BOT_TOKEN=your_bot_token
WEBHOOK_URL=your_webhook_url

# API
JWT_SECRET=your_jwt_secret
API_PORT=3000
```

## 📋 Development Phases

### Phase 1: Foundation ✅
- [x] Project structure setup
- [x] Database schema design
- [x] Basic API endpoints
- [x] Solana program framework

### Phase 2: Core Functionality 🔄
- [ ] Enhanced Solana programs with VRF
- [ ] Complete API implementation
- [ ] Frontend raffle hub development
- [ ] Bot integration with API

### Phase 3: Integration & Testing 📋
- [ ] End-to-end raffle flows
- [ ] Payment processing
- [ ] Real-time updates
- [ ] Comprehensive testing

### Phase 4: Deployment & Optimization 📋
- [ ] Production deployment
- [ ] Performance optimization
- [ ] Monitoring and alerts
- [ ] Documentation completion

## 🛠️ Technology Stack

### Backend
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with migrations
- **Authentication**: JWT with Solana wallet verification
- **Real-time**: WebSocket connections
- **Validation**: Joi schema validation

### Frontend
- **Framework**: Next.js 14 with App Router
- **Styling**: TailwindCSS + shadcn/ui components
- **State**: React Query + Zustand
- **Wallet**: Solana Wallet Adapter
- **Real-time**: Socket.IO client

### Blockchain
- **Platform**: Solana with Anchor framework
- **VRF**: ORAO Network for verifiable randomness
- **Storage**: Program Derived Addresses (PDAs)
- **Tokens**: Native SOL with future SPL token support

### Bot
- **Framework**: Telegraf.js
- **Integration**: REST API communication
- **Features**: Command handling, inline keyboards
- **Format**: Dramatic "survival" style messaging

## 📊 System Architecture

```mermaid
graph TB
    A[Frontend Raffle Hub] --> B[Backend API]
    C[Telegram Bot] --> B
    B --> D[PostgreSQL DB]
    B --> E[Solana Programs]
    E --> F[ORAO VRF]
    B --> G[WebSocket Server]
    G --> A
    G --> C
```

## 🎮 User Journey

### Via Frontend Hub
1. User connects Solana wallet
2. Browses available raffles
3. Purchases tickets with SOL
4. Watches live draw progress
5. Claims prizes automatically

### Via Telegram Bot
1. Bot announces new raffle
2. User clicks participation link
3. Completes purchase via bot commands
4. Bot narrates dramatic elimination draws
5. Winner notification and prize claim instructions

## 📁 Project Structure

```
v4/
├── backend/               # Express.js API server
│   ├── src/
│   │   ├── routes/       # API endpoints
│   │   ├── models/       # Database models
│   │   ├── services/     # Business logic
│   │   └── middleware/   # Auth, validation
│   └── migrations/       # Database migrations
├── frontend/             # Next.js raffle hub
│   ├── src/
│   │   ├── app/         # App router pages
│   │   ├── components/  # UI components
│   │   ├── hooks/       # Custom hooks
│   │   └── lib/         # Utilities
│   └── public/          # Static assets
├── programs/            # Solana programs
│   └── raffle/
│       ├── src/         # Anchor program
│       └── tests/       # Program tests
├── bot/                 # Telegram bot
│   ├── src/
│   │   ├── commands/    # Bot commands
│   │   ├── handlers/    # Event handlers
│   │   └── services/    # API integration
└── shared/              # Shared utilities
    ├── types/           # TypeScript types
    └── constants/       # Shared constants
```

## 🔧 Available Scripts

```bash
# Development
npm run dev:api          # Start API server
npm run dev:frontend     # Start Next.js dev server
npm run dev:bot          # Start Telegram bot
npm run dev:all          # Start all services

# Database
npm run db:migrate       # Run migrations
npm run db:seed          # Seed database
npm run db:reset         # Reset database

# Blockchain
npm run anchor:build     # Build Solana programs
npm run anchor:deploy    # Deploy to devnet
npm run anchor:test      # Run program tests

# Testing
npm run test             # Run all tests
npm run test:api         # Test API endpoints
npm run test:e2e         # End-to-end tests

# Production
npm run build            # Build all components
npm run start            # Start production servers
```

## 🎯 Key Features

### Trustless VRF Raffles
- Verifiable random number generation
- Transparent prize pool escrow
- Automated winner selection and payout
- Immutable draw history

### Modern Web Interface
- Responsive raffle browsing
- Real-time participation tracking
- Wallet integration for seamless payments
- Beautiful UI with shadcn/ui components

### Intelligent Bot Integration
- Dramatic raffle announcements
- Direct ticket purchase flows
- Live draw narration in "survival" style
- Prize claim assistance and history

### Real-time Communication
- WebSocket updates across all platforms
- Live raffle progress tracking
- Instant winner notifications
- Cross-platform synchronization

## 📈 Roadmap

### Q1 2025
- [x] v4 Foundation complete
- [ ] Core raffle functionality
- [ ] Beta frontend interface
- [ ] Basic bot integration

### Q2 2025
- [ ] Advanced VRF features
- [ ] Mobile-optimized PWA
- [ ] Enhanced bot AI
- [ ] Multi-token support

### Q3 2025
- [ ] DAO governance integration
- [ ] Cross-chain compatibility
- [ ] Advanced analytics
- [ ] API marketplace

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE.md](LICENSE.md) for details.

---

**v4 Status**: 🚧 Active Development - Building the Future of Decentralized Raffles