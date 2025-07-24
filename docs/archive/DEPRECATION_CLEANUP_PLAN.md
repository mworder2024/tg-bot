# Deprecation Cleanup Plan

## Executive Summary
This codebase contains significant deprecated code and documentation that should be removed to improve maintainability and reduce confusion.

## 1. Duplicate Index Files (HIGH PRIORITY)

### Files to Remove:
- `src/index-enhanced.ts` - Old enhanced version
- `src/index-fixed.ts` - Bug fix iteration
- `src/index-optimized.ts` - Performance optimization attempt
- `src/index-protected.ts` - Security hardening version
- `src/index-unified.ts` - Failed unification attempt

### Files to Keep:
- `src/index.ts` - Main bot entry point
- `src/index-quiz.ts` - Quiz game mode (has active npm script)

### Action Plan:
```bash
# Remove deprecated index files
rm src/index-enhanced.ts src/index-fixed.ts src/index-optimized.ts src/index-protected.ts src/index-unified.ts
rm dist/index-enhanced.js dist/index-fixed.js dist/index-optimized.js dist/index-protected.js dist/index-unified.js

# Update package.json to remove unused scripts
# Remove: dev:unified, dev:enhanced, start:unified, start:enhanced, start:both
```

## 2. Outdated Documentation (MEDIUM PRIORITY)

### Migration/Planning Docs to Archive:
```
docs/archive/
├── MIGRATION_TO_OPTIMIZED_BOT.md
├── MIGRATION_GUIDE.md
├── SPARC_PHASE1_SPECIFICATION.md
├── SPARC_PHASE2_PSEUDOCODE.md
├── SPARC_PHASE3_ARCHITECTURE.md
├── SPARC_PHASE4_REFINEMENT.md
├── IMPLEMENTATION_ROADMAP.md
├── PROJECT_COMPLETION_SUMMARY.md
└── DRAW_SYSTEM.md
```

### Root Markdown Files to Move:
- `STRESS_TEST_REPORT.md` → `docs/reports/`
- `SIMPLE_REACT_OPTION.md` → Archive or delete
- `SIMPLE_WEB_SETUP.md` → Archive or delete
- `CODEBASE_ANALYSIS_REPORT.md` → `docs/reports/`
- `DEPENDENCY_RESOLUTION_ANALYSIS.md` → `docs/reports/`

## 3. Unused Dependencies (LOW PRIORITY)

### API-Only Dependencies:
These are only used in the API server (`src/api/`):
- `@apollo/*` packages (7 packages)
- `graphql*` packages (4 packages)
- `socket.io*` packages (2 packages)

**Recommendation**: Keep if API server is actively used, otherwise remove.

### Test-Only Dependencies:
- `chai` - Using Jest instead
- `mocha` - Using Jest instead

**Action**: Remove chai and mocha, standardize on Jest.

## 4. Unused Test Files

### Files to Remove:
- `tests/test-sequencer.js`
- `tests/test-rate-limiting.js`

## 5. Package.json Scripts Cleanup

### Scripts to Remove:
```json
{
  "scripts": {
    // Remove these:
    "dev:unified": "tsx watch src/index-unified.ts",
    "dev:enhanced": "tsx watch src/index-enhanced.ts", 
    "start:unified": "node dist/index-unified.js",
    "start:enhanced": "node dist/index-enhanced.js",
    "start:both": "npm run start & npm run start:quiz"
  }
}
```

## 6. Safe Removal Strategy

### Phase 1: Backup and Archive (Day 1)
```bash
# Create archive directory
mkdir -p archive/deprecated-2024

# Move deprecated files
mv src/index-{enhanced,fixed,optimized,protected,unified}.ts archive/deprecated-2024/
mv docs/{MIGRATION*,SPARC*,IMPLEMENTATION_ROADMAP.md} archive/deprecated-2024/docs/
```

### Phase 2: Update Dependencies (Day 2)
```bash
# Remove unused test frameworks
npm uninstall chai mocha @types/chai

# Update package.json scripts
# Remove deprecated script entries
```

### Phase 3: Clean Documentation (Day 3)
```bash
# Reorganize documentation
mkdir -p docs/{reports,archive}
mv STRESS_TEST_REPORT.md docs/reports/
mv CODEBASE_ANALYSIS_REPORT.md docs/reports/

# Archive old docs
mv docs/{MIGRATION*,PROJECT_COMPLETION*} docs/archive/
```

### Phase 4: Final Cleanup (Day 4)
```bash
# Remove compiled artifacts
rm dist/index-{enhanced,fixed,optimized,protected,unified}.js

# Run tests to ensure nothing broke
npm test

# Commit changes
git add -A
git commit -m "chore: remove deprecated code and documentation"
```

## 7. Monitoring After Cleanup

### Verification Checklist:
- [ ] All tests pass
- [ ] Main bot starts successfully (`npm start`)
- [ ] Quiz bot starts successfully (`npm run start:quiz`)
- [ ] API server starts if needed (`npm run start:api`)
- [ ] No broken imports or missing dependencies
- [ ] Documentation is up-to-date

## 8. Long-term Maintenance

### Prevent Future Accumulation:
1. **Code Review Policy**: Reject PRs that add duplicate implementations
2. **Documentation Standards**: Archive old docs instead of keeping in root
3. **Dependency Audit**: Monthly review of unused dependencies
4. **Script Cleanup**: Remove npm scripts when features are deprecated

## Summary Statistics

- **Files to Remove**: 12 source files, 5 test files
- **Documentation to Archive**: 15+ markdown files  
- **Dependencies to Remove**: 2 (chai, mocha)
- **Scripts to Remove**: 5 npm scripts
- **Estimated Space Saved**: ~500KB source, ~5MB with dependencies

## Risk Assessment

- **Low Risk**: Removing duplicate index files (clear alternatives exist)
- **Low Risk**: Archiving old documentation (historical record preserved)
- **Medium Risk**: Removing test frameworks (ensure Jest covers all cases)
- **No Risk**: Cleaning up npm scripts (unused commands)

---

**Recommendation**: Execute this cleanup plan in phases over 4 days to ensure safe removal with ability to rollback if issues arise.