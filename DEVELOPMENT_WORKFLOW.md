# Development Workflow for Lottery Bot

## Branch Strategy

### Main Branches
- `main` - Production-ready code (stable)
- `develop` - Integration branch for features
- `feature/*` - Individual feature branches

## Feature Development Workflow

### 1. Start New Feature
```bash
# Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# Example:
git checkout -b feature/add-prize-tracking
```

### 2. Develop Feature
```bash
# Work on your feature
# Run tests frequently during development
npm test

# Check TypeScript compilation
npm run build

# Run linting
npm run lint
```

### 3. Commit Changes (Pre-commit hooks run automatically)
```bash
# Stage your changes
git add .

# Commit (pre-commit hooks will run tests)
git commit -m "feat: Add prize tracking system"

# If pre-commit fails, fix issues and try again
```

### 4. Push Feature Branch
```bash
# Push to remote
git push origin feature/your-feature-name
```

### 5. Create Pull Request
```bash
# Option 1: Using GitHub CLI
gh pr create --base develop --title "Add prize tracking system" --body "Description of changes"

# Option 2: Use GitHub web interface
# Go to repository and click "New Pull Request"
```

### 6. Code Review & CI
- Automated tests run via GitHub Actions
- Code review by team members
- Address any feedback

### 7. Merge to Develop
```bash
# After approval, merge to develop
git checkout develop
git pull origin develop
git merge --no-ff feature/your-feature-name
git push origin develop
```

### 8. Release to Main (Production)
```bash
# When develop is stable and tested
git checkout main
git pull origin main
git merge --no-ff develop
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin main --tags
```

## Automated Checks

### Pre-commit Hooks (Local)
The following checks run automatically before each commit:
1. TypeScript compilation (`npm run build`)
2. ESLint (`npm run lint`)
3. Unit tests (`npm test`)
4. TODO check (warnings only)
5. console.log check (warnings only)

### GitHub Actions (CI/CD)
The following checks run on push and PR:
1. TypeScript compilation
2. Linting
3. Full test suite
4. Coverage reporting
5. Security audit

## Setting Up Git Hooks

```bash
# Configure git to use our hooks directory
git config core.hooksPath .githooks

# Or copy hooks to .git/hooks
cp .githooks/pre-commit .git/hooks/
chmod +x .git/hooks/pre-commit
```

## Quick Commands

```bash
# Run all checks manually
npm run precommit

# Run specific checks
npm run build        # TypeScript compilation
npm run lint         # ESLint
npm test            # Run tests
npm run test:watch  # Watch mode for TDD
npm run test:coverage # Generate coverage report
```

## Feature Branch Naming Convention

- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions/updates
- `chore/` - Maintenance tasks

## Commit Message Format

Follow conventional commits:
```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Tests
- `chore`: Maintenance

Example:
```
feat(prizes): Add winner statistics command

- Added /winnerstats command to display top winners
- Fixed Markdown escaping for usernames with underscores
- Integrated with callback manager
```

## Emergency Hotfix Workflow

For critical production issues:
```bash
# Create hotfix from main
git checkout main
git checkout -b hotfix/critical-bug

# Fix the issue
# Run tests
npm test

# Commit and push
git add .
git commit -m "fix: Critical bug in prize calculation"
git push origin hotfix/critical-bug

# Create PR to main
gh pr create --base main --title "Hotfix: Critical bug"

# After merge, also merge to develop
git checkout develop
git merge hotfix/critical-bug
```