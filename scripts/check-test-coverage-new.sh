#!/bin/bash
# Script to ensure new TypeScript files have corresponding test files
# This script is intended to run in CI to enforce test-first development

set -e

# Get the base branch (default to main)
BASE_BRANCH="${BASE_BRANCH:-main}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Checking for new files without tests..."
echo "Base branch: $BASE_BRANCH"

# Directories to check (source code directories)
CHECK_DIRS="apps/api/src"

# Patterns to exclude from test requirement
EXCLUDE_PATTERNS=(
  "*.d.ts"           # Type definitions
  "*/types/*"        # Type files
  "*/index.ts"       # Index/barrel files
  "*/config/*"       # Configuration files
  "*/docs/*"         # Documentation
  "app.ts"           # Express app setup
  "index.ts"         # Entry points
)

# Build exclude grep pattern
EXCLUDE_GREP=""
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  EXCLUDE_GREP="$EXCLUDE_GREP -e $pattern"
done

# Get new TypeScript files (added in this branch compared to base)
NEW_FILES=$(git diff --name-only --diff-filter=A "$BASE_BRANCH"...HEAD 2>/dev/null || \
            git diff --name-only --diff-filter=A HEAD~1 2>/dev/null || \
            echo "")

if [ -z "$NEW_FILES" ]; then
  echo -e "${GREEN}No new files detected.${NC}"
  exit 0
fi

# Filter to only TypeScript source files in checked directories
MISSING_TESTS=()
CHECKED_COUNT=0

for file in $NEW_FILES; do
  # Skip if not in checked directories
  in_check_dir=false
  for dir in $CHECK_DIRS; do
    if [[ "$file" == "$dir"* ]]; then
      in_check_dir=true
      break
    fi
  done

  if [ "$in_check_dir" = false ]; then
    continue
  fi

  # Skip if not a TypeScript file
  if [[ ! "$file" =~ \.ts$ ]]; then
    continue
  fi

  # Skip test files themselves
  if [[ "$file" =~ \.test\.ts$ ]] || [[ "$file" =~ \.spec\.ts$ ]]; then
    continue
  fi

  # Skip excluded patterns
  skip=false
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]] || [[ "$file" == *"${pattern#\*}"* ]]; then
      skip=true
      break
    fi
  done

  if [ "$skip" = true ]; then
    echo -e "${YELLOW}Skipping (excluded): $file${NC}"
    continue
  fi

  CHECKED_COUNT=$((CHECKED_COUNT + 1))

  # Check for corresponding test file
  # Convert src path to tests path
  # e.g., apps/api/src/services/foo.ts -> apps/api/tests/unit/services/foo.test.ts
  test_file=$(echo "$file" | sed 's|/src/|/tests/unit/|' | sed 's|\.ts$|.test.ts|')

  if [[ ! -f "$test_file" ]]; then
    MISSING_TESTS+=("$file -> Expected: $test_file")
  fi
done

echo ""
echo "Checked $CHECKED_COUNT new source files."

if [ ${#MISSING_TESTS[@]} -eq 0 ]; then
  echo -e "${GREEN}All new files have corresponding test files.${NC}"
  exit 0
else
  echo -e "${RED}ERROR: The following new files are missing test files:${NC}"
  echo ""
  for missing in "${MISSING_TESTS[@]}"; do
    echo -e "${RED}  - $missing${NC}"
  done
  echo ""
  echo -e "${YELLOW}Please create test files for all new source files.${NC}"
  echo "Test file naming convention: src/path/file.ts -> tests/unit/path/file.test.ts"
  exit 1
fi
