# Phase 1: Foundation Setup - Detailed Task Breakdown

## 🎯 Overview
Transform high-level Phase 1 tasks into actionable SPARC-ready subtasks with clear acceptance criteria.

## 1.1 Project Initialization

### 1.1.1 Create Next.js Project
```bash
# Task: Initialize Next.js 14 with TypeScript
npx create-next-app@latest lottery-pwa --typescript --tailwind --app --src-dir
```
**Subtasks:**
- [ ] Run create-next-app command
- [ ] Configure `next.config.js` for PWA support
- [ ] Setup `tsconfig.json` with strict mode
- [ ] Create initial folder structure
- [ ] Remove boilerplate code
**Time**: 30 minutes
**Dependencies**: None

### 1.1.2 Configure ESLint
**Subtasks:**
- [ ] Install additional ESLint plugins:
  ```bash
  pnpm add -D @typescript-eslint/eslint-plugin eslint-plugin-react-hooks eslint-plugin-jsx-a11y
  ```
- [ ] Create `.eslintrc.js` with custom rules
- [ ] Add lint scripts to package.json
- [ ] Test linting on sample files
**Time**: 45 minutes
**Dependencies**: 1.1.1

### 1.1.3 Configure Prettier
**Subtasks:**
- [ ] Install Prettier:
  ```bash
  pnpm add -D prettier eslint-config-prettier
  ```
- [ ] Create `.prettierrc.json` configuration
- [ ] Create `.prettierignore` file
- [ ] Setup VSCode integration
- [ ] Add format script to package.json
**Time**: 30 minutes
**Dependencies**: 1.1.1

### 1.1.4 Setup Git Hooks
**Subtasks:**
- [ ] Install Husky and lint-staged:
  ```bash
  pnpm add -D husky lint-staged
  npx husky init
  ```
- [ ] Configure pre-commit hook for linting
- [ ] Configure commit-msg hook for conventional commits
- [ ] Add prepare script to package.json
- [ ] Test hooks with sample commit
**Time**: 45 minutes
**Dependencies**: 1.1.2, 1.1.3

### 1.1.5 Configure Path Aliases
**Subtasks:**
- [ ] Update `tsconfig.json` with path mappings:
  ```json
  {
    "compilerOptions": {
      "paths": {
        "@/*": ["./src/*"],
        "@components/*": ["./src/components/*"],
        "@lib/*": ["./src/lib/*"],
        "@hooks/*": ["./src/hooks/*"],
        "@styles/*": ["./src/styles/*"]
      }
    }
  }
  ```
- [ ] Test imports with aliases
- [ ] Update example imports
**Time**: 20 minutes
**Dependencies**: 1.1.1

### 1.1.6 Setup Environment Variables
**Subtasks:**
- [ ] Create `.env.local` file
- [ ] Create `.env.example` with all variables
- [ ] Install `zod` for env validation:
  ```bash
  pnpm add zod
  ```
- [ ] Create `src/lib/env.ts` for type-safe env access
- [ ] Add env validation to `next.config.js`
**Time**: 45 minutes
**Dependencies**: 1.1.1

## 1.2 PWA Configuration

### 1.2.1 Install next-pwa
**Subtasks:**
- [ ] Install dependencies:
  ```bash
  pnpm add next-pwa
  pnpm add -D @types/node
  ```
- [ ] Create `next.config.js` PWA configuration
- [ ] Setup workbox configuration
- [ ] Test service worker registration
**Time**: 45 minutes
**Dependencies**: 1.1.1

### 1.2.2 Create App Manifest
**Subtasks:**
- [ ] Create `public/manifest.json`:
  ```json
  {
    "name": "Solana VRF Lottery",
    "short_name": "VRF Lottery",
    "description": "Decentralized lottery game on Solana",
    "theme_color": "#7C3AED",
    "background_color": "#0F0F0F",
    "display": "standalone",
    "scope": "/",
    "start_url": "/"
  }
  ```
- [ ] Add manifest link to app layout
- [ ] Configure theme colors
- [ ] Add iOS meta tags
**Time**: 30 minutes
**Dependencies**: 1.2.1

### 1.2.3 Design App Icons
**Subtasks:**
- [ ] Create base icon design (SVG)
- [ ] Generate icon sizes:
  - 192x192
  - 512x512
  - Apple touch icons
  - Favicon variants
- [ ] Use `pwa-asset-generator`:
  ```bash
  npx pwa-asset-generator logo.svg public/icons
  ```
- [ ] Update manifest with icon paths
- [ ] Test on different devices
**Time**: 90 minutes
**Dependencies**: 1.2.2

### 1.2.4 Configure Service Worker
**Subtasks:**
- [ ] Create custom service worker strategies
- [ ] Configure offline page
- [ ] Setup cache strategies:
  - Network first for API
  - Cache first for assets
  - Stale while revalidate for images
- [ ] Implement update notification
- [ ] Test offline functionality
**Time**: 120 minutes
**Dependencies**: 1.2.1

### 1.2.5 Setup Offline Pages
**Subtasks:**
- [ ] Create `public/offline.html`
- [ ] Design offline UI component
- [ ] Create `src/app/offline/page.tsx`
- [ ] Configure service worker fallback
- [ ] Test offline navigation
**Time**: 60 minutes
**Dependencies**: 1.2.4

## 1.3 Development Environment

### 1.3.1 Setup FaunaDB
**Subtasks:**
- [ ] Create FaunaDB account
- [ ] Create new database
- [ ] Install FaunaDB SDK:
  ```bash
  pnpm add faunadb
  ```
- [ ] Create initial collections schema
- [ ] Generate API keys
- [ ] Create `src/lib/fauna.ts` client
- [ ] Test connection
**Time**: 60 minutes
**Dependencies**: 1.1.6

### 1.3.2 Configure Redis
**Subtasks:**
- [ ] Install Redis locally or use Redis Cloud
- [ ] Install Redis client:
  ```bash
  pnpm add ioredis
  ```
- [ ] Create `src/lib/redis.ts` client
- [ ] Configure connection pooling
- [ ] Test basic operations
- [ ] Setup Redis Commander (optional)
**Time**: 45 minutes
**Dependencies**: 1.1.6

### 1.3.3 Setup GraphQL Server
**Subtasks:**
- [ ] Install dependencies:
  ```bash
  pnpm add @apollo/server graphql graphql-tag
  ```
- [ ] Create `src/graphql/schema.ts`
- [ ] Setup Apollo Server in `src/app/api/graphql/route.ts`
- [ ] Configure GraphQL Playground
- [ ] Create hello world resolver
- [ ] Test with playground
**Time**: 90 minutes
**Dependencies**: 1.1.1

### 1.3.4 Configure Solana Devnet
**Subtasks:**
- [ ] Install Solana web3.js:
  ```bash
  pnpm add @solana/web3.js
  ```
- [ ] Create devnet connection utility
- [ ] Setup devnet wallet
- [ ] Configure RPC endpoints
- [ ] Test connection to devnet
- [ ] Create transaction helpers
**Time**: 60 minutes
**Dependencies**: 1.1.6

### 1.3.5 Development Wallet Setup
**Subtasks:**
- [ ] Install Solana wallet adapter:
  ```bash
  pnpm add @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets
  ```
- [ ] Create wallet provider component
- [ ] Configure supported wallets
- [ ] Create development keypair
- [ ] Add wallet UI components
- [ ] Test wallet connection
**Time**: 90 minutes
**Dependencies**: 1.3.4

## 📊 Phase 1 Summary

### Total Estimated Time: 14.5 hours

### Task Distribution:
- Project Initialization: 3.5 hours
- PWA Configuration: 5.5 hours  
- Development Environment: 5.5 hours

### Critical Path:
1.1.1 → 1.1.2/1.1.3 → 1.1.4 → PWA tasks → Dev Environment

### Success Criteria:
- [ ] Next.js app runs successfully
- [ ] PWA installable on mobile
- [ ] All development tools configured
- [ ] Can connect to Solana devnet
- [ ] GraphQL playground accessible
- [ ] Offline mode works

### SPARC Implementation Notes:
Each subtask can be implemented using SPARC methodology:
1. **Spec**: Define exact requirements
2. **Pseudocode**: Plan implementation steps
3. **Architecture**: Design component structure
4. **Refinement**: Implement with TDD
5. **Completion**: Verify and document