#!/bin/bash
# Quality Check script - runs tests, lint, format:check, and typecheck per-app in parallel
# Edit the APPS=(...) array to match your app folders under apps/.
#
# EVERY CHECK HERE MUST BE READ-ONLY. Do not put a writing command (`format`,
# `biome check --write`, `--fix`) in CHECKS: the gate would rewrite your source
# while reporting green, and — because the checks run concurrently — it would race
# the other three reading the same files. Run `bun run format` yourself; this
# script only ever verifies.
#
# Every app under apps/ must define ALL of the CHECKS names below as scripts in
# its package.json. They are invoked per-app by name, so a missing one fails with
# `error: Script not found`, which is a red check, not a skipped one.

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Script-relative root detection — works whether called from root or apps/*/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Cross-platform millisecond time
get_ms() {
    if command -v gdate &> /dev/null; then
        gdate +%s%3N
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        python3 -c 'import time; print(int(time.time() * 1000))'
    else
        date +%s%3N
    fi
}

# Format time helper
format_time() {
    local ms=$1
    if [ "$ms" -ge 1000 ]; then
        printf "%.1fs" "$(echo "scale=1; $ms/1000" | bc)"
    else
        echo "${ms}ms"
    fi
}

# Strip ANSI codes helper
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g'
}

APPS=("mobile" "api" "web")
CHECKS=("test" "lint" "format:check" "typecheck")

echo -e "${BLUE}${BOLD}📋 Running QC checks in parallel...${NC}\n"

OVERALL_START=$(get_ms)

# Create a temp directory for all output files
TMP_DIR=$(mktemp -d)

# Launch all subshells in parallel (apps × checks)
for app in "${APPS[@]}"; do
    for check in "${CHECKS[@]}"; do
        (
            START=$(get_ms)
            # Check names may contain a colon (format:check) — sanitise for filenames.
            SAFE="${check//:/_}"
            cd "$ROOT_DIR/apps/$app" && bun run --silent "$check" > "$TMP_DIR/${app}_${SAFE}.out" 2>&1
            echo $? > "$TMP_DIR/${app}_${SAFE}.exit"
            END=$(get_ms)
            echo $((END - START)) > "$TMP_DIR/${app}_${SAFE}.time"
        ) &
    done
done

# Wait for all jobs to finish
wait

OVERALL_END=$(get_ms)
OVERALL_TIME=$((OVERALL_END - OVERALL_START))

# Track overall pass/fail
OVERALL_PASS=true

# Display results per-app
APP_ICONS=("📱" "⚙️ " "🌐")
APP_LABELS=("MOBILE" "API" "WEB")

for i in "${!APPS[@]}"; do
    app="${APPS[$i]}"
    icon="${APP_ICONS[$i]}"
    label="${APP_LABELS[$i]}"

    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${CYAN}${BOLD}${icon} ${label}${NC}"
    echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    for check in "${CHECKS[@]}"; do
        SAFE="${check//:/_}"
        OUT="$TMP_DIR/${app}_${SAFE}.out"
        EXIT_CODE=$(cat "$TMP_DIR/${app}_${SAFE}.exit")
        TIME_MS=$(cat "$TMP_DIR/${app}_${SAFE}.time")
        OUTPUT=$(cat "$OUT")
        CLEAN=$(echo "$OUTPUT" | strip_ansi)

        case "$check" in
            test)
                PASS=$(echo "$CLEAN" | grep -oE '[0-9]+ pass' | awk '{sum += $1} END {print sum+0}')
                FAIL=$(echo "$CLEAN" | grep -oE '[0-9]+ fail' | awk '{sum += $1} END {print sum+0}')
                [ -z "$PASS" ] && PASS="0"
                [ -z "$FAIL" ] && FAIL="0"
                METRIC="${PASS} pass, ${FAIL} fail"
                LABEL_STR="Tests     "
                ;;
            lint)
                FILES=$(echo "$CLEAN" | grep -oE 'Checked [0-9]+ files' | grep -oE '[0-9]+' | awk '{sum += $1} END {print sum+0}')
                ERRORS=$(echo "$CLEAN" | grep -oE 'Found [0-9]+ errors?' | grep -oE '[0-9]+' | awk '{sum += $1} END {print sum+0}')
                WARNINGS=$(echo "$CLEAN" | grep -oE 'Found [0-9]+ warnings?' | grep -oE '[0-9]+' | awk '{sum += $1} END {print sum+0}')
                [ -z "$FILES" ] && FILES="0"
                [ -z "$ERRORS" ] && ERRORS="0"
                [ -z "$WARNINGS" ] && WARNINGS="0"
                METRIC="${FILES} files · ${ERRORS} errors"
                [ "$WARNINGS" -gt 0 ] && METRIC="${METRIC}, ${WARNINGS} warnings"
                LABEL_STR="Lint      "
                ;;
            format:check)
                # `biome format .` (read-only) prints "Checked N files in Xms. No
                # fixes applied." and, on drift, "Found N errors." — it never prints
                # "Formatted"/"Fixed", which only the --write variant emits.
                FILES=$(echo "$CLEAN" | grep -oE 'Checked [0-9]+ files' | grep -oE '[0-9]+' | awk '{sum += $1} END {print sum+0}')
                ERRORS=$(echo "$CLEAN" | grep -oE 'Found [0-9]+ errors?' | grep -oE '[0-9]+' | awk '{sum += $1} END {print sum+0}')
                [ -z "$FILES" ] && FILES="0"
                [ -z "$ERRORS" ] && ERRORS="0"
                if [ "$ERRORS" -gt 0 ]; then
                    METRIC="${FILES} files · ${ERRORS} unformatted"
                else
                    METRIC="${FILES} files"
                fi
                LABEL_STR="Format    "
                ;;
            typecheck)
                ERRORS=$(echo "$CLEAN" | grep -oE 'error TS[0-9]+' | wc -l | tr -d ' ')
                [ -z "$ERRORS" ] && ERRORS="0"
                METRIC="${ERRORS} errors"
                LABEL_STR="TypeCheck "
                ;;
        esac

        TIME_STR=$(format_time "$TIME_MS")

        if [ "$EXIT_CODE" -eq 0 ]; then
            printf "  ${GREEN}✅${NC} ${BOLD}%-10s${NC} %-36s ${DIM}%s${NC}\n" "$LABEL_STR" "$METRIC" "$TIME_STR"
        else
            OVERALL_PASS=false
            printf "  ${RED}❌${NC} ${BOLD}%-10s${NC} %-36s ${DIM}%s${NC}\n" "$LABEL_STR" "$METRIC" "$TIME_STR"
            # Show full error output indented under the failing check
            if [ -n "$OUTPUT" ]; then
                echo -e "  ${DIM}─── output ──────────────────────────────────────${NC}"
                echo "$OUTPUT" | sed 's/^/  /'
                echo -e "  ${DIM}─────────────────────────────────────────────────${NC}"
            fi
            # This gate verifies but never writes, so name the command that fixes it.
            case "$check" in
                format:check)
                    echo -e "  ${YELLOW}→ Fix: run ${BOLD}bun run format${NC}${YELLOW} from the repo root, then re-run qc.${NC}"
                    ;;
                lint)
                    echo -e "  ${YELLOW}→ Fix: ${BOLD}bun run format${NC}${YELLOW} applies Biome's safe + unsafe fixes; fix what remains by hand.${NC}"
                    ;;
            esac
        fi
    done

    echo ""
done

# Cleanup temp files
rm -rf "$TMP_DIR"

# Final summary
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "⏱  ${DIM}Total: $(format_time $OVERALL_TIME)${NC}"

if [ "$OVERALL_PASS" = true ]; then
    echo -e "${GREEN}${BOLD}✅ All checks passed.${NC}\n"
    exit 0
else
    echo -e "${RED}${BOLD}❌ Some checks failed. See details above.${NC}\n"
    exit 1
fi
