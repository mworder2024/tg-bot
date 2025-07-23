# Phase 1: Next.js PWA Setup Specification

## Objective
Initialize a production-ready Next.js 14 application with TypeScript, PWA support, and proper development tooling for the Solana VRF Lottery application.

## Requirements

### Functional Requirements
1. Create Next.js 14 app with App Router architecture
2. Configure TypeScript with strict mode for type safety
3. Setup TailwindCSS for utility-first styling
4. Configure PWA capabilities with offline support
5. Implement development tooling (ESLint, Prettier, Husky)
6. Setup environment variable management with validation
7. Configure path aliases for clean imports

### Non-Functional Requirements
1. Performance: Initial bundle < 200KB gzipped
2. Type Safety: 100% TypeScript coverage
3. Code Quality: Automated linting and formatting
4. Security: Environment variable validation
5. Developer Experience: Hot reload, clear errors

## Constraints
- Must use Next.js 14 with App Router (not Pages Router)
- Must support Node.js 18+ 
- Must be deployable to Vercel/Netlify
- Must work offline after initial load
- Must support Solana wallet integrations

## Test Scenarios

### Success Cases
1. App creates successfully and runs on http://localhost:3000
2. TypeScript compilation passes with no errors
3. PWA installs on mobile device
4. Environment variables load correctly
5. Path aliases resolve properly

### Edge Cases
1. Missing environment variables show clear error
2. Offline mode displays appropriate UI
3. Old browser shows upgrade message
4. Build process catches type errors

### Failure Cases
1. Invalid environment variables prevent startup
2. TypeScript errors block build
3. PWA manifest validation fails

## Pseudocode

```pseudocode
FUNCTION setupNextJsProject():
    // Step 1: Initialize project
    projectName = "solana-lottery-pwa"
    createNextApp(projectName, {
        typescript: true,
        tailwind: true,
        app: true,
        srcDir: true,
        importAlias: "@/*"
    })
    
    // Step 2: Configure TypeScript
    tsConfig = {
        compilerOptions: {
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
            paths: {
                "@/*": ["./src/*"],
                "@components/*": ["./src/components/*"],
                "@lib/*": ["./src/lib/*"],
                "@hooks/*": ["./src/hooks/*"],
                "@styles/*": ["./src/styles/*"],
                "@types/*": ["./src/types/*"]
            }
        }
    }
    writeFile("tsconfig.json", tsConfig)
    
    // Step 3: Setup ESLint
    eslintConfig = {
        extends: [
            "next/core-web-vitals",
            "plugin:@typescript-eslint/recommended",
            "prettier"
        ],
        rules: {
            "@typescript-eslint/no-unused-vars": "error",
            "@typescript-eslint/no-explicit-any": "error",
            "react-hooks/exhaustive-deps": "warn"
        }
    }
    writeFile(".eslintrc.json", eslintConfig)
    
    // Step 4: Configure Prettier
    prettierConfig = {
        semi: true,
        trailingComma: "es5",
        singleQuote: true,
        printWidth: 80,
        tabWidth: 2,
        useTabs: false
    }
    writeFile(".prettierrc.json", prettierConfig)
    
    // Step 5: Setup Git hooks
    installHusky()
    addHook("pre-commit", "lint-staged")
    addHook("commit-msg", "commitlint")
    
    // Step 6: Configure PWA
    installPackage("next-pwa")
    nextConfig = {
        reactStrictMode: true,
        swcMinify: true,
        compiler: {
            removeConsole: process.env.NODE_ENV === "production"
        },
        pwa: {
            dest: "public",
            register: true,
            skipWaiting: true,
            disable: process.env.NODE_ENV === "development"
        }
    }
    writeFile("next.config.js", nextConfig)
    
    // Step 7: Create environment validation
    envSchema = {
        NEXT_PUBLIC_SOLANA_RPC_URL: z.string().url(),
        NEXT_PUBLIC_SOLANA_NETWORK: z.enum(["devnet", "mainnet-beta"]),
        NEXT_PUBLIC_PROGRAM_ID: z.string().min(32),
        // ... other env vars
    }
    createEnvValidation(envSchema)
    
    // Step 8: Setup project structure
    createDirectories([
        "src/components/ui",
        "src/components/lottery",
        "src/components/wallet",
        "src/lib/solana",
        "src/lib/utils",
        "src/hooks",
        "src/types",
        "src/styles"
    ])
    
    // Step 9: Create base files
    createAppLayout()
    createHomePage()
    createGlobalStyles()
    createManifest()
    
    // Step 10: Verify setup
    runTests()
    checkTypeScript()
    validatePWA()

FUNCTION createManifest():
    manifest = {
        name: "Solana VRF Lottery",
        short_name: "VRF Lottery",
        description: "Decentralized lottery game on Solana",
        theme_color: "#7C3AED",
        background_color: "#0F0F0F",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: generateIcons()
    }
    writeFile("public/manifest.json", manifest)

FUNCTION createEnvValidation(schema):
    envFile = `
        import { z } from 'zod';
        
        const envSchema = ${schema};
        
        export const env = envSchema.parse({
            NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
            // ... other vars
        });
    `
    writeFile("src/lib/env.ts", envFile)

FUNCTION runTests():
    // Verify build
    IF NOT buildSucceeds() THEN
        THROW "Build failed"
    
    // Check TypeScript
    IF NOT typeCheckPasses() THEN
        THROW "Type errors found"
    
    // Validate PWA
    IF NOT pwaManifestValid() THEN
        THROW "PWA configuration invalid"
    
    // Test dev server
    IF NOT devServerStarts() THEN
        THROW "Dev server failed to start"
```

## Module Structure

```
pwa/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout with providers
│   │   ├── page.tsx            # Home page
│   │   ├── globals.css         # Global styles
│   │   └── manifest.ts         # Web manifest generation
│   ├── components/
│   │   ├── ui/                 # Base UI components
│   │   ├── lottery/            # Lottery-specific components
│   │   └── wallet/             # Wallet integration components
│   ├── lib/
│   │   ├── env.ts              # Environment validation
│   │   ├── utils.ts            # Utility functions
│   │   └── solana/             # Blockchain utilities
│   ├── hooks/                  # Custom React hooks
│   ├── types/                  # TypeScript type definitions
│   └── styles/                 # Additional styles
├── public/
│   ├── manifest.json           # PWA manifest
│   └── icons/                  # App icons
├── next.config.js              # Next.js configuration
├── tsconfig.json               # TypeScript configuration
├── .eslintrc.json              # ESLint rules
├── .prettierrc.json            # Prettier configuration
├── .env.example                # Environment template
└── package.json                # Dependencies
```

## Success Criteria
1. ✅ Next.js app runs without errors
2. ✅ TypeScript strict mode enabled
3. ✅ PWA scores 90+ on Lighthouse
4. ✅ All development tools configured
5. ✅ Environment variables validated
6. ✅ Git hooks prevent bad commits

## Next Steps
After successful setup:
1. Implement PWA service worker configuration
2. Setup FaunaDB and GraphQL
3. Integrate Solana wallet adapter
4. Create base UI components