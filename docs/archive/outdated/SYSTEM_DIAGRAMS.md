# System Architecture Diagrams

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph "Client Layer"
        PWA[PWA Frontend]
        TG[Telegram Bot]
        DC[Discord Bot]
        Mobile[Mobile Apps]
    end
    
    subgraph "API Gateway Layer"
        GW[GraphQL Gateway]
        LB[Load Balancer]
        CDN[CDN]
    end
    
    subgraph "Microservices Layer"
        AUTH[Auth Service]
        GAME[Game Service]
        PAY[Payment Service]
        NOTIFY[Notification Service]
        ANALYTICS[Analytics Service]
        VRF[VRF Oracle Service]
    end
    
    subgraph "Blockchain Layer"
        SOLANA[Solana Program]
        ORACLE[Switchboard Oracle]
        RPC[Solana RPC]
    end
    
    subgraph "Data Layer"
        FAUNA[FaunaDB]
        REDIS[Redis Cache]
        POSTGRES[PostgreSQL]
        TIMESCALE[TimescaleDB]
    end
    
    subgraph "Infrastructure Layer"
        K8S[Kubernetes]
        PROM[Prometheus]
        GRAF[Grafana]
        JAEGER[Jaeger]
    end
    
    PWA --> LB
    TG --> LB
    DC --> LB
    Mobile --> LB
    
    LB --> GW
    CDN --> PWA
    
    GW --> AUTH
    GW --> GAME
    GW --> PAY
    GW --> NOTIFY
    GW --> ANALYTICS
    GW --> VRF
    
    AUTH --> REDIS
    AUTH --> POSTGRES
    GAME --> FAUNA
    GAME --> REDIS
    PAY --> SOLANA
    PAY --> RPC
    ANALYTICS --> TIMESCALE
    VRF --> ORACLE
    VRF --> SOLANA
    
    K8S --> AUTH
    K8S --> GAME
    K8S --> PAY
    K8S --> NOTIFY
    K8S --> ANALYTICS
    K8S --> VRF
    
    PROM --> K8S
    GRAF --> PROM
    JAEGER --> GW
```

## 2. Microservices Communication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant GW as GraphQL Gateway
    participant AUTH as Auth Service
    participant GAME as Game Service
    participant PAY as Payment Service
    participant VRF as VRF Service
    participant SOL as Solana Program
    participant NOTIFY as Notification Service
    
    U->>GW: Create Paid Game Request
    GW->>AUTH: Validate JWT Token
    AUTH-->>GW: User Authenticated
    
    GW->>GAME: Create Game with Payment Required
    GAME->>PAY: Initialize Payment Escrow
    PAY->>SOL: Create Game PDA
    SOL-->>PAY: Game Account Created
    PAY-->>GAME: Payment Address Ready
    GAME-->>GW: Game Created with Payment Info
    
    GW->>NOTIFY: Send Game Announcement
    NOTIFY->>TG: Broadcast to Telegram
    NOTIFY->>DC: Broadcast to Discord
    
    U->>GW: Join Game Request
    GW->>AUTH: Validate User
    GW->>PAY: Process Entry Payment
    PAY->>SOL: Transfer Tokens to Escrow
    SOL-->>PAY: Payment Confirmed
    PAY-->>GW: Entry Confirmed
    
    GW->>GAME: Add Player to Game
    GAME->>VRF: Request Random Number
    VRF->>SOL: Submit VRF Proof
    SOL-->>VRF: VRF Verified
    VRF-->>GAME: Random Number Generated
    
    GAME->>PAY: Distribute Prizes
    PAY->>SOL: Execute Prize Distribution
    SOL-->>PAY: Distribution Complete
    
    GAME->>NOTIFY: Announce Winners
    NOTIFY->>TG: Send Winner Notifications
    NOTIFY->>DC: Send Winner Notifications
```

## 3. GraphQL Federation Schema

```mermaid
graph LR
    subgraph "Gateway Schema"
        UNIFIED[Unified Schema]
    end
    
    subgraph "Auth Subgraph"
        A1[User Entity]
        A2[Session Type]
        A3[Wallet Type]
    end
    
    subgraph "Game Subgraph"
        G1[Game Entity]
        G2[Player Type]
        G3[Round Type]
    end
    
    subgraph "Payment Subgraph"
        P1[Payment Entity]
        P2[Transaction Type]
        P3[Prize Type]
    end
    
    subgraph "Analytics Subgraph"
        AN1[GameAnalytics Type]
        AN2[UserStats Type]
        AN3[SystemMetrics Type]
    end
    
    UNIFIED --> A1
    UNIFIED --> G1
    UNIFIED --> P1
    UNIFIED --> AN1
    
    A1 -.->|@key| G1
    A1 -.->|@key| P1
    G1 -.->|@key| P1
    G1 -.->|@key| AN1
    A1 -.->|@key| AN2
```

## 4. SIWS Authentication Flow

```mermaid
graph TD
    A[User Opens App] --> B{Wallet Connected?}
    B -->|No| C[Connect Wallet]
    B -->|Yes| D[Check Auth Status]
    
    C --> E[Request Signature]
    E --> F[Generate SIWS Message]
    F --> G[User Signs Message]
    G --> H[Verify Signature]
    H --> I{Valid Signature?}
    
    I -->|No| J[Authentication Failed]
    I -->|Yes| K[Generate JWT Token]
    K --> L[Store Session]
    L --> M[Authenticated]
    
    D --> N{Valid Session?}
    N -->|Yes| M
    N -->|No| O[Refresh Token]
    O --> P{Refresh Valid?}
    P -->|Yes| K
    P -->|No| E
    
    J --> C
```

## 5. Solana Program Architecture

```mermaid
graph TB
    subgraph "Program Instructions"
        I1[initialize]
        I2[create_game]
        I3[join_game]
        I4[select_number]
        I5[submit_vrf]
        I6[process_elimination]
        I7[complete_game]
        I8[claim_prize]
        I9[request_refund]
        I10[cancel_game]
        I11[withdraw_treasury]
    end
    
    subgraph "Program Accounts"
        A1[Treasury State PDA]
        A2[Game State PDA]
        A3[VRF Result PDA]
        A4[Player Token Account]
        A5[Escrow Token Account]
    end
    
    subgraph "External Accounts"
        E1[MWOR Token Mint]
        E2[User Token Accounts]
        E3[Switchboard VRF]
    end
    
    I2 --> A2
    I3 --> A2
    I3 --> A5
    I4 --> A2
    I5 --> A3
    I6 --> A2
    I6 --> A3
    I7 --> A2
    I7 --> A1
    I8 --> A2
    I8 --> E2
    I9 --> A2
    I9 --> E2
    I11 --> A1
    
    A2 --> E1
    A5 --> E1
    E2 --> E1
    I5 --> E3
```

## 6. Data Flow Architecture

```mermaid
graph LR
    subgraph "Data Sources"
        US[User Actions]
        BC[Blockchain Events]
        SYS[System Events]
    end
    
    subgraph "Data Ingestion"
        STREAM[Event Streams]
        BATCH[Batch Processors]
    end
    
    subgraph "Data Processing"
        TRANSFORM[Data Transformation]
        VALIDATE[Data Validation]
        ENRICH[Data Enrichment]
    end
    
    subgraph "Data Storage"
        OLTP[OLTP - FaunaDB]
        CACHE[Cache - Redis]
        ANALYTICS[OLAP - TimescaleDB]
        LOGS[Logs - Elasticsearch]
    end
    
    subgraph "Data Consumption"
        REALTIME[Real-time Dashboards]
        REPORTS[Scheduled Reports]
        ALERTS[Alert System]
        API[GraphQL API]
    end
    
    US --> STREAM
    BC --> STREAM
    SYS --> BATCH
    
    STREAM --> TRANSFORM
    BATCH --> TRANSFORM
    
    TRANSFORM --> VALIDATE
    VALIDATE --> ENRICH
    
    ENRICH --> OLTP
    ENRICH --> CACHE
    ENRICH --> ANALYTICS
    ENRICH --> LOGS
    
    OLTP --> API
    CACHE --> API
    ANALYTICS --> REPORTS
    ANALYTICS --> REALTIME
    LOGS --> ALERTS
```

## 7. Security Architecture

```mermaid
graph TB
    subgraph "External Layer"
        INTERNET[Internet]
        DDOS[DDoS Protection]
        WAF[Web Application Firewall]
    end
    
    subgraph "Network Layer"
        LB[Load Balancer]
        TLS[TLS Termination]
        VPC[Virtual Private Cloud]
    end
    
    subgraph "Application Layer"
        GATEWAY[API Gateway]
        AUTH[Authentication]
        AUTHZ[Authorization]
        RATE[Rate Limiting]
    end
    
    subgraph "Service Layer"
        ENCRYPT[Encryption at Rest]
        AUDIT[Audit Logging]
        SECRETS[Secret Management]
        RBAC[Role-Based Access]
    end
    
    subgraph "Data Layer"
        BACKUP[Encrypted Backups]
        MONITOR[Security Monitoring]
        INCIDENT[Incident Response]
    end
    
    INTERNET --> DDOS
    DDOS --> WAF
    WAF --> LB
    LB --> TLS
    TLS --> VPC
    
    VPC --> GATEWAY
    GATEWAY --> AUTH
    AUTH --> AUTHZ
    AUTHZ --> RATE
    
    RATE --> ENCRYPT
    ENCRYPT --> AUDIT
    AUDIT --> SECRETS
    SECRETS --> RBAC
    
    RBAC --> BACKUP
    BACKUP --> MONITOR
    MONITOR --> INCIDENT
```

## 8. Deployment Architecture

```mermaid
graph TB
    subgraph "Development"
        DEV[Development Environment]
        COMPOSE[Docker Compose]
        LOCAL[Local Services]
    end
    
    subgraph "CI/CD Pipeline"
        GIT[Git Repository]
        BUILD[Build & Test]
        SCAN[Security Scan]
        PACKAGE[Container Build]
        DEPLOY[Deployment]
    end
    
    subgraph "Staging Environment"
        STAGE[Staging Cluster]
        TEST[Integration Tests]
        VALIDATE[Validation]
    end
    
    subgraph "Production Environment"
        PROD[Production Cluster]
        MULTI[Multi-Zone Deployment]
        MONITOR[Production Monitoring]
    end
    
    subgraph "Infrastructure"
        K8S[Kubernetes]
        HELM[Helm Charts]
        TERRAFORM[Terraform]
        VAULT[HashiCorp Vault]
    end
    
    DEV --> GIT
    GIT --> BUILD
    BUILD --> SCAN
    SCAN --> PACKAGE
    PACKAGE --> DEPLOY
    
    DEPLOY --> STAGE
    STAGE --> TEST
    TEST --> VALIDATE
    VALIDATE --> PROD
    
    PROD --> MULTI
    MULTI --> MONITOR
    
    K8S --> STAGE
    K8S --> PROD
    HELM --> K8S
    TERRAFORM --> K8S
    VAULT --> K8S
```

## 9. Monitoring and Observability

```mermaid
graph LR
    subgraph "Data Collection"
        METRICS[Metrics Collection]
        LOGS[Log Aggregation]
        TRACES[Distributed Tracing]
        EVENTS[Custom Events]
    end
    
    subgraph "Processing"
        PROMETHEUS[Prometheus]
        ELASTICSEARCH[Elasticsearch]
        JAEGER[Jaeger]
        KAFKA[Event Streaming]
    end
    
    subgraph "Storage"
        TSDB[Time Series DB]
        LOGSTORE[Log Storage]
        TRACESTORE[Trace Storage]
        EVENTSTORE[Event Store]
    end
    
    subgraph "Visualization"
        GRAFANA[Grafana Dashboards]
        KIBANA[Kibana Logs]
        JAEGERUI[Jaeger UI]
        CUSTOM[Custom Dashboards]
    end
    
    subgraph "Alerting"
        ALERTMANAGER[Alert Manager]
        PAGERDUTY[PagerDuty]
        SLACK[Slack Notifications]
        EMAIL[Email Alerts]
    end
    
    METRICS --> PROMETHEUS
    LOGS --> ELASTICSEARCH
    TRACES --> JAEGER
    EVENTS --> KAFKA
    
    PROMETHEUS --> TSDB
    ELASTICSEARCH --> LOGSTORE
    JAEGER --> TRACESTORE
    KAFKA --> EVENTSTORE
    
    TSDB --> GRAFANA
    LOGSTORE --> KIBANA
    TRACESTORE --> JAEGERUI
    EVENTSTORE --> CUSTOM
    
    GRAFANA --> ALERTMANAGER
    ALERTMANAGER --> PAGERDUTY
    ALERTMANAGER --> SLACK
    ALERTMANAGER --> EMAIL
```

## 10. PWA Architecture

```mermaid
graph TB
    subgraph "PWA Shell"
        SHELL[App Shell]
        SW[Service Worker]
        MANIFEST[Web App Manifest]
    end
    
    subgraph "Frontend Components"
        REACT[React Components]
        ROUTER[React Router]
        STATE[Redux Store]
        CACHE[Apollo Cache]
    end
    
    subgraph "PWA Features"
        OFFLINE[Offline Support]
        PUSH[Push Notifications]
        INSTALL[App Installation]
        BACKGROUND[Background Sync]
    end
    
    subgraph "Device Integration"
        CAMERA[Camera Access]
        STORAGE[Local Storage]
        CRYPTO[Web Crypto API]
        WALLET[Wallet Integration]
    end
    
    subgraph "Platform Adapters"
        WEB[Web Browser]
        MOBILE[Mobile (Capacitor)]
        DESKTOP[Desktop (Electron)]
        TELEGRAM[Telegram Mini App]
    end
    
    SHELL --> REACT
    SW --> OFFLINE
    SW --> PUSH
    SW --> BACKGROUND
    MANIFEST --> INSTALL
    
    REACT --> ROUTER
    ROUTER --> STATE
    STATE --> CACHE
    
    OFFLINE --> STORAGE
    PUSH --> STORAGE
    BACKGROUND --> STORAGE
    
    CRYPTO --> WALLET
    CAMERA --> WALLET
    
    WEB --> SHELL
    MOBILE --> SHELL
    DESKTOP --> SHELL
    TELEGRAM --> SHELL
```

These diagrams provide a comprehensive visual representation of the system architecture, showing how all components interact and the flow of data and control throughout the system.