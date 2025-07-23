# 📋 SPARC Phase 1: Specification - Decentralized Raffle Hub v4

**Document Type**: System Requirements Specification  
**Phase**: SPARC Phase 1 - Specification  
**Status**: 🔄 In Progress  
**Created**: January 15, 2025

## 🎯 EXECUTIVE SUMMARY

The Decentralized Raffle Hub v4 is a comprehensive ecosystem that combines trustless blockchain technology with intuitive user interfaces to create a transparent, secure, and engaging raffle platform.

### Vision Statement
Create the world's most transparent and user-friendly decentralized raffle platform where participants can trust the process, enjoy seamless interaction, and experience dramatic entertainment through multiple touchpoints.

## 📊 SYSTEM REQUIREMENTS

### 1. FUNCTIONAL REQUIREMENTS

#### 1.1 Raffle Management System
**REQ-F-001**: **Raffle Creation**
- System SHALL allow authorized users to create new raffles
- Each raffle SHALL have configurable parameters:
  - Prize amount (SOL value)
  - Ticket price (SOL amount)
  - Maximum participants (1-10000)
  - Duration (1 hour - 30 days)
  - Start time (immediate or scheduled)
- System SHALL generate unique raffle IDs
- System SHALL create escrow PDA for prize funds

**REQ-F-002**: **Ticket Purchase**
- Users SHALL purchase tickets with SOL payments
- System SHALL enforce maximum ticket limits per user
- System SHALL prevent duplicate ticket purchases
- Payment SHALL be atomic (success or complete rollback)
- System SHALL generate verifiable ticket receipts

**REQ-F-003**: **VRF-Based Winner Selection**
- System SHALL use ORAO VRF for verifiable randomness
- Winner selection SHALL be transparent and auditable
- System SHALL handle multiple winner scenarios
- VRF proofs SHALL be stored on-chain
- Selection process SHALL be irreversible once initiated

**REQ-F-004**: **Prize Distribution**
- Winners SHALL receive automatic prize distribution
- System SHALL handle prize splitting for multiple winners
- Platform SHALL collect configurable fees (1-5%)
- Unclaimed prizes SHALL have configurable timeout (30-365 days)
- System SHALL support automatic refunds for cancelled raffles

#### 1.2 User Interface Requirements

**REQ-F-005**: **Frontend Raffle Hub (Next.js)**
- Interface SHALL display active raffles in grid layout
- Users SHALL connect Solana wallets (Phantom, Solflare)
- Real-time ticket counter updates
- Live draw visualization with countdown timers
- Responsive design for mobile/desktop
- Dark/light theme support

**REQ-F-006**: **Telegram Bot Integration**
- Bot SHALL announce new raffles automatically
- Users SHALL purchase tickets via bot commands
- Bot SHALL provide dramatic "survival" style draw narration
- Users SHALL query ticket status and history
- Bot SHALL send winner notifications
- Deep linking to frontend hub

#### 1.3 Backend API Requirements

**REQ-F-007**: **RESTful API Services**
- Authentication via JWT and Solana wallet verification
- CRUD operations for raffle management
- Real-time WebSocket updates for draw events
- Rate limiting and request validation
- Comprehensive error handling and logging

**REQ-F-008**: **Database Management**
- PostgreSQL storage for raffle metadata
- User profiles and preferences
- Transaction history and analytics
- Backup and recovery procedures
- Data retention policies

### 2. NON-FUNCTIONAL REQUIREMENTS

#### 2.1 Performance Requirements
**REQ-NF-001**: **Response Times**
- API responses SHALL complete within 200ms (95th percentile)
- Frontend page loads SHALL complete within 3 seconds
- VRF resolution SHALL complete within 60 seconds
- Real-time updates SHALL propagate within 5 seconds

**REQ-NF-002**: **Scalability**
- System SHALL support 10,000 concurrent users
- Database SHALL handle 1 million raffle records
- Bot SHALL process 100 messages per second
- Frontend SHALL render 1000+ active raffles

#### 2.2 Security Requirements
**REQ-NF-003**: **Blockchain Security**
- All prize funds SHALL be secured in PDAs
- Smart contracts SHALL be audited for vulnerabilities
- Private keys SHALL never be stored or transmitted
- VRF randomness SHALL be cryptographically verifiable

**REQ-NF-004**: **Application Security**
- API SHALL implement rate limiting (100 req/min per IP)
- Input validation SHALL prevent injection attacks
- Authentication tokens SHALL expire within 24 hours
- Sensitive data SHALL be encrypted at rest

#### 2.3 Reliability Requirements
**REQ-NF-005**: **Availability**
- System SHALL maintain 99.9% uptime
- Planned maintenance SHALL not exceed 4 hours/month
- Automatic failover for critical components
- Graceful degradation during partial outages

**REQ-NF-006**: **Data Integrity**
- All transactions SHALL be atomic and consistent
- Database SHALL implement backup every 6 hours
- Blockchain state SHALL be the authoritative source
- Audit logs SHALL be immutable and timestamped

## 🎮 USER STORIES

### Epic 1: Raffle Participation
**US-001**: As a raffle participant, I want to browse active raffles so I can choose which ones to enter.
**US-002**: As a raffle participant, I want to see clear prize amounts and odds so I can make informed decisions.
**US-003**: As a raffle participant, I want to purchase tickets quickly with my Solana wallet.
**US-004**: As a raffle participant, I want to track my tickets and see draw results in real-time.

### Epic 2: Raffle Creation
**US-005**: As a raffle creator, I want to set up new raffles with custom parameters.
**US-006**: As a raffle creator, I want to promote my raffles through the Telegram bot.
**US-007**: As a raffle creator, I want to monitor ticket sales and participant engagement.
**US-008**: As a raffle creator, I want automated prize distribution without manual intervention.

### Epic 3: Entertainment Experience
**US-009**: As a Telegram user, I want dramatic draw narrations that make the experience exciting.
**US-010**: As a frontend user, I want smooth animations and visual effects during draws.
**US-011**: As a participant, I want instant notifications when I win prizes.
**US-012**: As a community member, I want to share results and celebrate winners.

## 🔧 TECHNICAL SPECIFICATIONS

### 3.1 Solana Program Architecture

#### Program Accounts
```rust
// Program Derived Addresses (PDAs)
pub struct RaffleProgram {
    // Global program state
    pub authority: Pubkey,
    pub fee_rate: u16,        // Basis points (100 = 1%)
    pub min_duration: i64,    // Minimum raffle duration in seconds
    pub max_duration: i64,    // Maximum raffle duration in seconds
}

pub struct RaffleAccount {
    pub id: u64,              // Unique raffle identifier
    pub creator: Pubkey,      // Raffle creator's wallet
    pub prize_amount: u64,    // Prize pool in lamports
    pub ticket_price: u64,    // Price per ticket in lamports
    pub max_tickets: u32,     // Maximum number of tickets
    pub tickets_sold: u32,    // Current tickets sold
    pub start_time: i64,      // Raffle start timestamp
    pub end_time: i64,        // Raffle end timestamp
    pub status: RaffleStatus, // Current raffle state
    pub vrf_request: Option<Pubkey>, // VRF request account
    pub winner: Option<Pubkey>, // Winner's wallet (if selected)
}

pub struct TicketAccount {
    pub raffle_id: u64,       // Associated raffle
    pub owner: Pubkey,        // Ticket owner's wallet
    pub ticket_number: u32,   // Sequential ticket number
    pub purchase_time: i64,   // Purchase timestamp
}

#[derive(Clone, Copy, PartialEq)]
pub enum RaffleStatus {
    Active,      // Accepting ticket purchases
    Drawing,     // VRF in progress
    Complete,    // Winner selected, prizes distributed
    Cancelled,   // Refunds available
}
```

#### Program Instructions
1. **InitializeProgram** - One-time program setup
2. **CreateRaffle** - Create new raffle with escrow
3. **PurchaseTicket** - Buy raffle ticket with SOL
4. **RequestVRF** - Initiate winner selection process
5. **FulfillVRF** - Complete winner selection with VRF result
6. **DistributePrize** - Send winnings to winner
7. **RefundTickets** - Return funds for cancelled raffles
8. **UpdateProgramConfig** - Admin configuration changes

### 3.2 Backend API Specification

#### Core Endpoints
```typescript
// Authentication
POST   /api/auth/login          // Wallet signature verification
POST   /api/auth/refresh        // Token refresh
DELETE /api/auth/logout         // Session termination

// Raffle Management
GET    /api/raffles             // List active raffles (paginated)
POST   /api/raffles             // Create new raffle
GET    /api/raffles/:id         // Get raffle details
PUT    /api/raffles/:id         // Update raffle (creator only)
DELETE /api/raffles/:id         // Cancel raffle (creator only)

// Tickets
GET    /api/raffles/:id/tickets // List raffle tickets
POST   /api/raffles/:id/tickets // Purchase ticket
GET    /api/users/:id/tickets   // User's ticket history

// Winners & Results
GET    /api/raffles/:id/winner  // Get raffle winner
GET    /api/raffles/:id/proof   // Get VRF proof

// Analytics
GET    /api/stats/global        // Platform statistics
GET    /api/stats/user/:id      // User statistics

// WebSocket Events
'raffle:created'     // New raffle announcement
'raffle:ticket_sold' // Ticket purchase notification
'raffle:drawing'     // Draw process started
'raffle:winner'      // Winner announcement
'raffle:cancelled'   // Raffle cancellation
```

### 3.3 Frontend Component Architecture

#### React Component Hierarchy
```typescript
App
├── WalletProvider              // Solana wallet connection
├── SocketProvider             // Real-time updates
├── Layout
│   ├── Header                 // Navigation and wallet status
│   ├── Sidebar               // Filter and search
│   └── Footer                // Links and info
└── Pages
    ├── RaffleHub             // Main raffle grid
    │   ├── RaffleCard        // Individual raffle display
    │   ├── TicketModal       // Purchase interface
    │   └── DrawAnimation     // Live draw visualization
    ├── RaffleDetails         // Single raffle view
    │   ├── PrizeInfo         // Prize and odds display
    │   ├── ParticipantList   // Ticket holders
    │   └── DrawHistory       // Previous draws
    ├── UserProfile           // Personal dashboard
    │   ├── TicketHistory     // Past tickets
    │   ├── WinHistory        // Prize history
    │   └── CreateRaffle      // Raffle creation form
    └── AdminDashboard        // Platform management
        ├── RaffleManagement  // Monitor all raffles
        ├── UserManagement    // User administration
        └── Analytics         // Platform metrics
```

### 3.4 Telegram Bot Command Structure

#### Bot Commands
```typescript
// Public Commands
/start          // Welcome and instructions
/help           // Command documentation
/raffles        // List active raffles
/my_tickets     // User's ticket status
/winners        // Recent winners

// Raffle Interaction
/join [raffle_id]    // Quick ticket purchase
/details [raffle_id] // Raffle information
/status [raffle_id]  // Draw progress

// Administrative
/create         // Create raffle (authorized users)
/cancel [id]    // Cancel raffle (creator only)
/announce [id]  // Broadcast raffle

// Callback Handlers
raffle_join_[id]     // Inline keyboard ticket purchase
raffle_details_[id]  // Show detailed information
raffle_share_[id]    // Share raffle with friends
```

## 🔄 BUSINESS LOGIC FLOWS

### 4.1 Raffle Creation Flow
1. **Validation Phase**
   - Verify creator has sufficient SOL for prize + fees
   - Validate raffle parameters (duration, ticket price, etc.)
   - Check creator authorization level

2. **Blockchain Phase**
   - Create PDA escrow account
   - Transfer prize funds to escrow
   - Initialize raffle account with metadata
   - Emit raffle creation event

3. **Integration Phase**
   - Store raffle metadata in PostgreSQL
   - Trigger Telegram bot announcement
   - Update frontend real-time displays
   - Begin ticket sale period

### 4.2 Ticket Purchase Flow
1. **Pre-purchase Validation**
   - Verify raffle is active and not full
   - Check user hasn't exceeded ticket limits
   - Validate payment amount

2. **Payment Processing**
   - Create ticket account on blockchain
   - Transfer SOL from buyer to escrow
   - Generate ticket receipt and proof
   - Update ticket counter

3. **Post-purchase Actions**
   - Store ticket record in database
   - Send confirmation to user
   - Broadcast real-time update
   - Check if raffle is now full

### 4.3 Winner Selection Flow
1. **Draw Initiation**
   - Verify raffle end conditions met
   - Request VRF from ORAO network
   - Set raffle status to "Drawing"
   - Notify all participants

2. **VRF Processing**
   - Wait for VRF fulfillment
   - Verify randomness proof
   - Calculate winner from random seed
   - Update raffle account with winner

3. **Prize Distribution**
   - Transfer prize funds to winner
   - Collect platform fees
   - Update raffle status to "Complete"
   - Trigger winner notifications

## 📊 DATA MODELS

### 4.1 Database Schema (PostgreSQL)

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(44) UNIQUE NOT NULL,
    telegram_id BIGINT UNIQUE,
    display_name VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Raffles table
CREATE TABLE raffles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blockchain_id BIGINT UNIQUE NOT NULL,
    creator_id UUID REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    prize_amount BIGINT NOT NULL,
    ticket_price BIGINT NOT NULL,
    max_tickets INTEGER NOT NULL,
    tickets_sold INTEGER DEFAULT 0,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    winner_id UUID REFERENCES users(id),
    vrf_proof TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tickets table
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raffle_id UUID REFERENCES raffles(id),
    owner_id UUID REFERENCES users(id),
    ticket_number INTEGER NOT NULL,
    blockchain_signature VARCHAR(88) NOT NULL,
    purchased_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(raffle_id, ticket_number)
);

-- Transactions table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    raffle_id UUID REFERENCES raffles(id),
    type VARCHAR(20) NOT NULL, -- 'purchase', 'win', 'refund'
    amount BIGINT NOT NULL,
    signature VARCHAR(88) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 🎯 SUCCESS CRITERIA

### 5.1 Technical Success Metrics
- **Zero critical security vulnerabilities** in smart contracts
- **Sub-200ms API response times** for 95% of requests
- **99.9% uptime** for all core services
- **100% VRF verification success** rate
- **Automated prize distribution** within 5 minutes of draw completion

### 5.2 User Experience Metrics
- **<3 second page load times** for frontend
- **One-click ticket purchasing** with wallet integration
- **Real-time updates** across all platforms within 5 seconds
- **Mobile-responsive design** working on all screen sizes
- **Intuitive navigation** requiring minimal user training

### 5.3 Business Success Metrics
- **Support for 10,000+ concurrent users**
- **Process 1,000+ raffles simultaneously**
- **Handle $100,000+ in daily volume**
- **Achieve 95% user satisfaction** rating
- **Maintain platform fees** under 3% total transaction value

## ⚠️ CONSTRAINTS & ASSUMPTIONS

### 6.1 Technical Constraints
- **Solana Network Dependency**: Subject to network congestion and fees
- **VRF Timing**: ORAO VRF resolution typically takes 30-60 seconds
- **PostgreSQL Limits**: Database connection pooling and query optimization required
- **Real-time Updates**: WebSocket connections limited by server capacity

### 6.2 Business Constraints
- **Regulatory Compliance**: Must operate within legal frameworks
- **Fee Structure**: Platform sustainability requires minimum fee collection
- **User Acquisition**: Growth dependent on community adoption
- **Competition**: Existing platforms may have first-mover advantages

### 6.3 Assumptions
- **Solana Adoption**: Continued growth of Solana ecosystem
- **User Behavior**: Users comfortable with wallet interactions
- **Technical Skills**: Target audience has basic crypto knowledge
- **Market Demand**: Sufficient interest in decentralized raffles

---

**Next Phase**: SPARC Phase 2 - Pseudocode Development  
**Estimated Completion**: January 16, 2025  
**Document Status**: 95% Complete - Ready for Review