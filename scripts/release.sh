#!/bin/bash
set -e

# GitHub Release Creation Script for Reloaderoo
# This script handles only the GitHub release creation.
# Building and NPM publishing are handled by GitHub workflows.
#
# Usage: ./scripts/release.sh <version> [--dry-run]
VERSION=""
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ -z "$VERSION" ]]; then
    VERSION="$arg"
  fi
done

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [--dry-run]"
  echo ""
  echo "This script creates a GitHub release and tag. The GitHub workflow will handle:"
  echo "  - Building the project"
  echo "  - Testing CLI functionality"
  echo "  - Publishing to NPM"
  exit 1
fi

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+\.[0-9]+)?$ ]]; then
  echo "❌ Invalid version format: $VERSION"
  echo "Version must be in format: x.y.z or x.y.z-tag.n (e.g., 1.0.0 or 1.0.0-beta.1)"
  exit 1
fi

# Detect current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Enforce branch policy - only allow releases from main
if [[ "$BRANCH" != "main" ]]; then
  echo "❌ Error: Releases must be created from the main branch."
  echo "Current branch: $BRANCH"
  echo "Please switch to main and try again."
  exit 1
fi

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

# Ensure we're in the project root (parent of scripts directory)
cd "$(dirname "$0")/.."

# Check if working directory is clean
if ! git diff-index --quiet HEAD --; then
  echo "❌ Error: Working directory is not clean."
  echo "Please commit or stash your changes before creating a release."
  exit 1
fi

# Version update
echo ""
echo "🔧 Setting version to $VERSION..."
run "npm version \"$VERSION\" --no-git-tag-version"

# README update
echo ""
echo "📝 Updating version in README.md..."
# Update version references in code examples using extended regex for precise semver matching
run "sed -i '' -E 's/@[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+\.[0-9]+)?(-[a-zA-Z0-9]+\.[0-9]+)*(-[a-zA-Z0-9]+)?/@'"$VERSION"'/g' README.md"

# Update URL-encoded version references in shield links if they exist
echo "📝 Updating version in README.md shield links..."
run "sed -i '' -E 's/npm%3Areloaderoo%40[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+\.[0-9]+)?(-[a-zA-Z0-9]+\.[0-9]+)*(-[a-zA-Z0-9]+)?/npm%3Areloaderoo%40'"$VERSION"'/g' README.md"

# Update CLAUDE.md if it contains version references
if grep -q "@[0-9]\+\.[0-9]\+\.[0-9]\+" CLAUDE.md 2>/dev/null; then
  echo "📝 Updating version in CLAUDE.md..."
  run "sed -i '' -E 's/@[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+\.[0-9]+)?(-[a-zA-Z0-9]+\.[0-9]+)*(-[a-zA-Z0-9]+)?/@'"$VERSION"'/g' CLAUDE.md"
fi

# Git operations
echo ""
echo "📦 Committing version changes..."
if grep -q "@[0-9]\+\.[0-9]\+\.[0-9]\+" CLAUDE.md 2>/dev/null; then
  run "git add package.json README.md CLAUDE.md"
  run "git commit -m \"Release v$VERSION\""
else
  run "git add package.json README.md"
  run "git commit -m \"Release v$VERSION\""
fi
run "git tag \"v$VERSION\""

echo ""
echo "🚀 Pushing to origin..."
run "git push origin $BRANCH --tags"

echo ""
echo "🎯 Tag pushed! GitHub will automatically:"
echo "  - Detect the new tag and start the release workflow"
echo "  - Build the project and test CLI functionality"
echo "  - Publish to NPM"
echo "  - Create the GitHub release"
echo ""
echo "✅ Release v$VERSION initiated!"
echo "📝 Monitor the GitHub Actions workflow for completion"

# Determine repository URL from git remote
REPO_URL=$(git config --get remote.origin.url 2>/dev/null || echo "")
if [[ "$REPO_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  echo "📦 View workflow: https://github.com/${OWNER}/${REPO}/actions"
else
  echo "📦 View workflow in your repository's Actions tab"
fi