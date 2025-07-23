#!/bin/bash

# Git Version Workflow Script
# Manages versioning, releases, and deployment for the Telegram Lottery Bot

set -e

# Configuration
PROJECT_NAME="telegram-lottery-bot"
MAIN_BRANCH="main"
DEVELOP_BRANCH="develop"
VERSION_FILE="package.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
check_git_repo() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi
}

# Get current version from package.json
get_current_version() {
    node -p "require('./package.json').version"
}

# Update version in package.json
update_version() {
    local new_version=$1
    npm version $new_version --no-git-tag-version
    log_success "Updated version to $new_version"
}

# Create and push git tag
create_git_tag() {
    local version=$1
    local tag_name="v$version"
    
    git add package.json package-lock.json
    git commit -m "chore: bump version to $version

🚀 Release v$version

📦 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    
    git tag -a "$tag_name" -m "Release version $version

🎯 Release Highlights:
- Enhanced security fixes
- Performance improvements
- Bug fixes and stability

📦 Generated with [Claude Code](https://claude.ai/code)"
    
    log_success "Created tag $tag_name"
}

# Push changes and tags
push_changes() {
    local branch=$(git branch --show-current)
    git push origin $branch
    git push origin --tags
    log_success "Pushed changes and tags to origin"
}

# Create release branch
create_release_branch() {
    local version=$1
    local branch_name="release/v$version"
    
    git checkout -b $branch_name
    log_success "Created release branch $branch_name"
}

# Merge release to main
merge_to_main() {
    local version=$1
    local release_branch="release/v$version"
    
    git checkout $MAIN_BRANCH
    git pull origin $MAIN_BRANCH
    git merge --no-ff $release_branch -m "chore: release v$version

✅ Merged release/v$version to main

🚀 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    
    log_success "Merged $release_branch to $MAIN_BRANCH"
}

# Merge main back to develop
merge_to_develop() {
    git checkout $DEVELOP_BRANCH
    git pull origin $DEVELOP_BRANCH
    git merge --no-ff $MAIN_BRANCH -m "chore: merge main back to develop

🔄 Post-release sync

📦 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
    
    log_success "Merged $MAIN_BRANCH back to $DEVELOP_BRANCH"
}

# Clean up release branch
cleanup_release_branch() {
    local version=$1
    local release_branch="release/v$version"
    
    git branch -d $release_branch
    git push origin --delete $release_branch
    log_success "Cleaned up release branch $release_branch"
}

# Run tests
run_tests() {
    log_info "Running test suite..."
    if npm test; then
        log_success "All tests passed"
    else
        log_error "Tests failed - aborting release"
        exit 1
    fi
}

# Build project
build_project() {
    log_info "Building project..."
    if npm run build; then
        log_success "Build completed successfully"
    else
        log_error "Build failed - aborting release"
        exit 1
    fi
}

# Validate pre-release conditions
validate_pre_release() {
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        log_error "Uncommitted changes detected. Please commit or stash them first."
        exit 1
    fi
    
    # Check current branch
    local current_branch=$(git branch --show-current)
    if [ "$current_branch" != "$DEVELOP_BRANCH" ]; then
        log_warning "Not on develop branch. Current: $current_branch"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log_success "Pre-release validation passed"
}

# Generate changelog
generate_changelog() {
    local version=$1
    local changelog_file="CHANGELOG.md"
    
    if [ ! -f "$changelog_file" ]; then
        cat > "$changelog_file" << EOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

EOF
    fi
    
    # Add new version entry
    local date=$(date +%Y-%m-%d)
    local temp_file=$(mktemp)
    
    # Get commits since last tag
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    local commits=""
    
    if [ -n "$last_tag" ]; then
        commits=$(git log --oneline --pretty=format:"- %s" ${last_tag}..HEAD)
    else
        commits=$(git log --oneline --pretty=format:"- %s" HEAD)
    fi
    
    # Create new changelog entry
    {
        head -n 5 "$changelog_file"
        echo ""
        echo "## [v$version] - $date"
        echo ""
        echo "### Changes"
        echo "$commits"
        echo ""
        tail -n +6 "$changelog_file"
    } > "$temp_file"
    
    mv "$temp_file" "$changelog_file"
    git add "$changelog_file"
    
    log_success "Generated changelog for v$version"
}

# Main workflow functions
patch_release() {
    log_info "Creating patch release..."
    validate_pre_release
    build_project
    
    local new_version=$(npm version patch --no-git-tag-version | sed 's/v//')
    generate_changelog $new_version
    create_git_tag $new_version
    push_changes
    
    log_success "Patch release v$new_version completed!"
}

minor_release() {
    log_info "Creating minor release..."
    validate_pre_release
    run_tests
    build_project
    
    local new_version=$(npm version minor --no-git-tag-version | sed 's/v//')
    generate_changelog $new_version
    create_release_branch $new_version
    create_git_tag $new_version
    merge_to_main $new_version
    merge_to_develop
    cleanup_release_branch $new_version
    push_changes
    
    log_success "Minor release v$new_version completed!"
}

major_release() {
    log_info "Creating major release..."
    validate_pre_release
    run_tests
    build_project
    
    local new_version=$(npm version major --no-git-tag-version | sed 's/v//')
    generate_changelog $new_version
    create_release_branch $new_version
    create_git_tag $new_version
    merge_to_main $new_version
    merge_to_develop
    cleanup_release_branch $new_version
    push_changes
    
    log_success "Major release v$new_version completed!"
}

# Hotfix workflow
hotfix_start() {
    local version=$1
    if [ -z "$version" ]; then
        log_error "Hotfix version required"
        exit 1
    fi
    
    git checkout $MAIN_BRANCH
    git pull origin $MAIN_BRANCH
    git checkout -b "hotfix/v$version"
    
    log_success "Started hotfix branch hotfix/v$version"
}

hotfix_finish() {
    local version=$1
    if [ -z "$version" ]; then
        log_error "Hotfix version required"
        exit 1
    fi
    
    local hotfix_branch="hotfix/v$version"
    
    # Update version and create tag
    update_version $version
    generate_changelog $version
    create_git_tag $version
    
    # Merge to main
    git checkout $MAIN_BRANCH
    git merge --no-ff $hotfix_branch -m "hotfix: release v$version"
    
    # Merge to develop
    git checkout $DEVELOP_BRANCH
    git merge --no-ff $hotfix_branch -m "hotfix: merge v$version to develop"
    
    # Cleanup
    git branch -d $hotfix_branch
    push_changes
    
    log_success "Hotfix v$version completed!"
}

# Status and info commands
show_status() {
    local current_version=$(get_current_version)
    local current_branch=$(git branch --show-current)
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "No tags")
    
    echo "📊 Git Version Workflow Status"
    echo "────────────────────────────────"
    echo "Current Version: v$current_version"
    echo "Current Branch:  $current_branch"
    echo "Last Tag:        $last_tag"
    echo "Repository:      $(git remote get-url origin 2>/dev/null || echo 'No remote')"
    echo ""
    
    # Show recent commits
    echo "Recent Commits:"
    git log --oneline -5 --pretty=format:"  %h - %s (%an, %ar)"
    echo ""
}

# Help text
show_help() {
    cat << EOF
🚀 Git Version Workflow

USAGE:
    $0 <command> [options]

COMMANDS:
    patch           Create a patch release (x.x.X)
    minor           Create a minor release (x.X.0)  
    major           Create a major release (X.0.0)
    hotfix-start    Start a hotfix branch
    hotfix-finish   Finish a hotfix and merge
    status          Show current version status
    help            Show this help message

EXAMPLES:
    $0 patch                    # Create patch release
    $0 minor                    # Create minor release  
    $0 major                    # Create major release
    $0 hotfix-start 1.2.3       # Start hotfix v1.2.3
    $0 hotfix-finish 1.2.3      # Finish hotfix v1.2.3
    $0 status                   # Show current status

WORKFLOW:
    develop → release/vX.X.X → main → tag
                           ↘ develop

📦 Generated with [Claude Code](https://claude.ai/code)
EOF
}

# Main script logic
main() {
    check_git_repo
    
    case "${1:-help}" in
        "patch")
            patch_release
            ;;
        "minor")
            minor_release
            ;;
        "major")
            major_release
            ;;
        "hotfix-start")
            hotfix_start $2
            ;;
        "hotfix-finish")
            hotfix_finish $2
            ;;
        "status")
            show_status
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

# Execute main function with all arguments
main "$@"