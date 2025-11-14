#!/bin/bash

# Cleanup Check Script - Identifies potentially unused files and dependencies
# This script ONLY identifies candidates - it does NOT delete anything
# Review the output carefully before making any deletions

echo "========================================="
echo "    CLEANUP CHECK - READ ONLY"
echo "    This script identifies candidates"
echo "    It does NOT delete anything"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Change to frontend directory
cd frontend 2>/dev/null || { echo "Frontend directory not found"; exit 1; }

echo -e "${BLUE}=== 1. CHECKING FOR COMMON UNNECESSARY FILES ===${NC}"
echo "These files are often not needed in production:"
echo ""

# Check for test files that might not be used
if [ -d "__tests__" ] || [ -d "tests" ]; then
    echo -e "${YELLOW}• Test directories found${NC}"
    find . -type d -name "__tests__" -o -name "tests" 2>/dev/null | head -10
fi

# Check for example/sample files
echo ""
if ls *.example* *.sample* 2>/dev/null | grep -v ".env.example"; then
    echo -e "${YELLOW}• Example/sample files found (excluding .env.example):${NC}"
    ls *.example* *.sample* 2>/dev/null | grep -v ".env.example"
fi

# Check for backup files
echo ""
if ls *.bak *.backup *~ *.old 2>/dev/null; then
    echo -e "${YELLOW}• Backup files found:${NC}"
    ls *.bak *.backup *~ *.old 2>/dev/null
fi

# Check for log files
echo ""
if ls *.log 2>/dev/null; then
    echo -e "${YELLOW}• Log files found:${NC}"
    ls *.log 2>/dev/null
fi

echo ""
echo -e "${BLUE}=== 2. CHECKING BUILD/DIST DIRECTORIES ===${NC}"
if [ -d "dist" ]; then
    echo -e "${GREEN}• dist/ directory exists (build output - usually gitignored)${NC}"
    du -sh dist 2>/dev/null
fi

if [ -d "build" ]; then
    echo -e "${GREEN}• build/ directory exists${NC}"
    du -sh build 2>/dev/null
fi

echo ""
echo -e "${BLUE}=== 3. CHECKING FOR UNUSED CSS FILES ===${NC}"
# List CSS files and check if they're imported
for css_file in src/*.css; do
    if [ -f "$css_file" ]; then
        basename_css=$(basename "$css_file")
        # Check if CSS file is imported anywhere
        if ! grep -r "$basename_css" src/*.tsx src/*.ts src/*.jsx src/*.js 2>/dev/null | grep -q import; then
            echo -e "${YELLOW}• Potentially unused CSS: $css_file${NC}"
            echo "  (Not found in any import statements)"
        fi
    fi
done

echo ""
echo -e "${BLUE}=== 4. CHECKING FOR DUPLICATE OR TEMP FILES ===${NC}"
# Check for duplicate README files
readme_count=$(ls README* 2>/dev/null | wc -l)
if [ "$readme_count" -gt 1 ]; then
    echo -e "${YELLOW}• Multiple README files found:${NC}"
    ls -la README*
fi

# Check for temporary files
if ls .*.swp .*.swo *.tmp 2>/dev/null; then
    echo -e "${YELLOW}• Temporary files found:${NC}"
    ls .*.swp .*.swo *.tmp 2>/dev/null
fi

echo ""
echo -e "${BLUE}=== 5. CHECKING PACKAGE.JSON DEPENDENCIES ===${NC}"
echo "Analyzing which dependencies might be unused..."
echo "(Note: This is a basic check - some deps may be used indirectly)"
echo ""

# Extract dependencies from package.json
if [ -f "package.json" ]; then
    # Check for potentially unused dependencies
    echo -e "${YELLOW}Checking for common unused packages:${NC}"

    # List of packages to check if they're actually used
    packages_to_check=(
        "axios"           # if using fetch instead
        "lodash"          # if not using utility functions
        "moment"          # if using native Date
        "jquery"          # usually not needed with React
        "bootstrap"       # if using custom CSS
        "node-sass"       # if using regular CSS
        "@testing-library" # if not running tests
        "jest"            # if not running tests
        "eslint-plugin-"  # various eslint plugins
    )

    for pkg in "${packages_to_check[@]}"; do
        if grep -q "\"$pkg" package.json; then
            # Check if package is actually imported in the code
            if ! grep -r "from ['\"]\(@\)\?$pkg\|require(['\"]\(@\)\?$pkg" src/ 2>/dev/null | grep -v "node_modules" | grep -q .; then
                echo -e "  ${YELLOW}• '$pkg' is in package.json but no imports found${NC}"
            fi
        fi
    done
fi

echo ""
echo -e "${BLUE}=== 6. CHECKING FOR UNUSED COMPONENTS ===${NC}"
# List components that are not imported anywhere else
for component_file in src/*.tsx src/*.jsx src/components/*.tsx src/components/*.jsx; do
    if [ -f "$component_file" ]; then
        # Skip main files
        if [[ "$component_file" == *"main.tsx"* ]] || [[ "$component_file" == *"App.tsx"* ]] || [[ "$component_file" == *"index.tsx"* ]]; then
            continue
        fi

        component_name=$(basename "$component_file" | sed 's/\.[tj]sx\?$//')

        # Check if component is imported anywhere
        if ! grep -r "from.*$component_name\|import.*$component_name" src/ 2>/dev/null | grep -v "$component_file" | grep -q .; then
            echo -e "${YELLOW}• Component might be unused: $component_file${NC}"
        fi
    fi
done

echo ""
echo -e "${BLUE}=== 7. CHECKING NODE_MODULES SIZE ===${NC}"
if [ -d "node_modules" ]; then
    size=$(du -sh node_modules | cut -f1)
    echo -e "${GREEN}• node_modules size: $size${NC}"
    echo "  (This is excluded from git but affects local disk space)"
fi

echo ""
echo -e "${BLUE}=== 8. GIT IGNORED FILES THAT EXIST LOCALLY ===${NC}"
echo "These files exist but are gitignored (safe to delete if not needed):"
if [ -f ".gitignore" ]; then
    while IFS= read -r pattern; do
        # Skip comments and empty lines
        if [[ "$pattern" =~ ^#.*$ ]] || [ -z "$pattern" ]; then
            continue
        fi

        # Check if files matching this pattern exist
        if ls $pattern 2>/dev/null | grep -v "node_modules" | head -5; then
            echo -e "${GREEN}  • Files matching gitignore pattern '$pattern' exist${NC}"
        fi
    done < .gitignore
fi

echo ""
echo -e "${BLUE}=== SUMMARY ===${NC}"
echo -e "${GREEN}This script has identified potentially unused files and dependencies.${NC}"
echo -e "${RED}DO NOT delete anything without careful review!${NC}"
echo ""
echo "Recommended actions:"
echo "1. Review each item carefully"
echo "2. Verify files are truly unused before deletion"
echo "3. Keep .env.example for documentation"
echo "4. Keep at least one README file"
echo "5. Run 'npm run build' after any changes to verify nothing breaks"
echo ""
echo "To check if a specific import is used:"
echo "  grep -r 'import.*ComponentName' src/"
echo ""
echo "To check if a package is used:"
echo "  grep -r 'packageName' src/"
echo ""
echo -e "${GREEN}=== SCAN COMPLETE ===${NC}"
