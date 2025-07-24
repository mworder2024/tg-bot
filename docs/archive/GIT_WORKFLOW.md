# Git Version Workflow

This document outlines the comprehensive git workflow for the Telegram Lottery Bot project, including versioning, releases, and deployment strategies.

## 🏗️ Branch Structure

### Main Branches
- **`main`** - Production-ready code, stable releases only
- **`develop`** - Integration branch for features, pre-release testing

### Supporting Branches
- **`feature/*`** - New features (branch from develop)
- **`release/*`** - Release preparation (branch from develop)
- **`hotfix/*`** - Critical fixes (branch from main)

## 📦 Versioning Strategy

We follow [Semantic Versioning](https://semver.org/) (SemVer):

```
MAJOR.MINOR.PATCH
```

- **MAJOR** - Breaking changes, API changes
- **MINOR** - New features, backwards compatible
- **PATCH** - Bug fixes, backwards compatible

### Examples
- `1.0.0` → `1.0.1` (patch: bug fix)
- `1.0.1` → `1.1.0` (minor: new feature)
- `1.1.0` → `2.0.0` (major: breaking change)

## 🚀 Release Process

### 1. Feature Development

```bash
# Start new feature
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# Work on feature
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/your-feature-name
# Create PR to develop branch
```

### 2. Release Preparation

```bash
# Create release branch
git checkout develop
git pull origin develop
git checkout -b release/v1.2.0

# Finalize release
npm version minor  # Updates package.json
git add package.json package-lock.json
git commit -m "chore: bump version to 1.2.0"

# Test release
npm run build
npm test
```

### 3. Release Deployment

```bash
# Merge to main
git checkout main
git pull origin main
git merge --no-ff release/v1.2.0

# Tag release
git tag -a v1.2.0 -m "Release version 1.2.0"

# Push everything
git push origin main
git push origin --tags

# Merge back to develop
git checkout develop
git merge --no-ff main

# Cleanup
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

## 🔧 Automated Workflow Scripts

### Quick Release Commands

```bash
# Patch release (1.0.0 → 1.0.1)
./scripts/version-workflow.sh patch

# Minor release (1.0.0 → 1.1.0)  
./scripts/version-workflow.sh minor

# Major release (1.0.0 → 2.0.0)
./scripts/version-workflow.sh major

# Check status
./scripts/version-workflow.sh status
```

### Hotfix Process

```bash
# Start hotfix
./scripts/version-workflow.sh hotfix-start 1.0.1

# Make fixes, then finish
./scripts/version-workflow.sh hotfix-finish 1.0.1
```

## 📋 Pre-Release Checklist

### Before Creating Release

- [ ] All features merged to develop
- [ ] All tests passing
- [ ] Build successful
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Security scan passed
- [ ] Performance tests completed

### Release Validation

- [ ] TypeScript compilation ✅
- [ ] ESLint checks ✅  
- [ ] Unit tests ✅
- [ ] Integration tests ✅
- [ ] Security audit ✅
- [ ] Dependencies updated ✅

## 🛠️ Package.json Scripts

Enhanced scripts for version management:

```json
{
  "scripts": {
    "version:patch": "./scripts/version-workflow.sh patch",
    "version:minor": "./scripts/version-workflow.sh minor", 
    "version:major": "./scripts/version-workflow.sh major",
    "version:status": "./scripts/version-workflow.sh status",
    "release:validate": "npm run build && npm run lint && npm test",
    "release:prepare": "npm run release:validate && npm run changelog",
    "changelog": "conventional-changelog -p angular -i CHANGELOG.md -s"
  }
}
```

## 🔄 Git Hooks Integration

### Pre-commit Hook
- TypeScript compilation
- Linting checks
- Unit tests
- Security scan

### Pre-push Hook
- Full test suite
- Build verification
- Branch validation

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Code style changes
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance tasks

**Examples:**
```
feat(auth): add JWT token validation
fix(database): resolve connection timeout issue
docs(api): update endpoint documentation
chore: bump dependencies to latest versions
```

## 📊 Release Types & Timing

### Regular Releases
- **Patch releases** - Weekly (bug fixes)
- **Minor releases** - Monthly (new features)
- **Major releases** - Quarterly (breaking changes)

### Emergency Releases
- **Hotfixes** - As needed (critical bugs)
- **Security patches** - Immediate (security vulnerabilities)

## 🔐 Security Considerations

### Sensitive Information
- Never commit private keys, tokens, or passwords
- Use environment variables for configuration
- Review all commits for sensitive data
- Use `.gitignore` for sensitive files

### Release Security
- GPG sign all release tags
- Verify build integrity
- Security audit before release
- Update security dependencies

## 📈 Monitoring & Metrics

### Release Metrics
- Build success rate
- Test coverage percentage
- Deployment frequency
- Mean time to recovery (MTTR)

### Quality Gates
- All tests must pass
- Code coverage > 80%
- No critical security vulnerabilities
- Performance benchmarks met

## 🚨 Emergency Procedures

### Rollback Process
```bash
# Immediate rollback
git checkout main
git revert HEAD~1  # Revert last commit
git push origin main

# Tag rollback
git tag -a v1.0.1-rollback -m "Emergency rollback"
git push origin --tags
```

### Hotfix Deployment
```bash
# Create hotfix
./scripts/version-workflow.sh hotfix-start 1.0.1

# Fix issue, test, and deploy
git add .
git commit -m "fix: critical security vulnerability"
./scripts/version-workflow.sh hotfix-finish 1.0.1
```

## 📚 Additional Resources

- [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/)
- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Keep a Changelog](https://keepachangelog.com/)

---

**Generated with [Claude Code](https://claude.ai/code)**