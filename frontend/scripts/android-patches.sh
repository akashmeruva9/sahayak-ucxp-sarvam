#!/usr/bin/env bash
# Save / restore the hand-applied node_modules patches the Android build needs.
#
# Several node_modules build.gradle files were patched to read
# `System.getProperty("NODE_EXECUTABLE")` so Gradle can find nvm's node. Any
# `npm install` / `expo install` overwrites them, and the Android build then
# fails with "command 'node' not found".
#
#   ./scripts/android-patches.sh save      # before running any npm install
#   ./scripts/android-patches.sh restore   # after
#   ./scripts/android-patches.sh check     # are the patches currently applied?
#
# See PLAN.md §7 #25 and the project memory on Android node/Gradle patches.

set -euo pipefail

FRONTEND="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP="$FRONTEND/.android-patches"
MARKER="NODE_EXECUTABLE"

find_patched() {
  # The patch lives in .gradle, .gradle.kts AND .kt files (the Expo/RN Gradle
  # plugins are Kotlin). Matching only "*.gradle" silently misses 10 of the 15.
  grep -rl "$MARKER" "$FRONTEND/node_modules" \
    --include="*.gradle" --include="*.kts" --include="*.kt" 2>/dev/null || true
}

case "${1:-check}" in
  save)
    rm -rf "$BACKUP"
    count=0
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      rel="${file#"$FRONTEND"/}"
      mkdir -p "$BACKUP/$(dirname "$rel")"
      cp "$file" "$BACKUP/$rel"
      count=$((count + 1))
    done < <(find_patched)
    echo "saved $count patched file(s) -> ${BACKUP#"$FRONTEND"/}"
    [ "$count" -eq 0 ] && echo "WARNING: nothing found — are the patches already gone?" && exit 1
    exit 0
    ;;

  restore)
    [ -d "$BACKUP" ] || { echo "no backup at $BACKUP — run 'save' first"; exit 1; }
    count=0
    while IFS= read -r -d '' file; do
      rel="${file#"$BACKUP"/}"
      if [ -f "$FRONTEND/$rel" ]; then
        cp "$file" "$FRONTEND/$rel"
        count=$((count + 1))
      else
        echo "  skipped (module gone): $rel"
      fi
    done < <(find "$BACKUP" -type f -print0)
    echo "restored $count patched file(s)"
    exit 0
    ;;

  check)
    count=$(find_patched | wc -l | tr -d ' ')
    echo "$count node_modules .gradle file(s) currently carry the $MARKER patch"
    [ -d "$BACKUP" ] && echo "backup holds $(find "$BACKUP" -type f | wc -l | tr -d ' ') file(s)"
    [ "$count" -eq 0 ] && echo "PATCHES MISSING — run: $0 restore" && exit 1
    exit 0
    ;;

  *)
    echo "usage: $0 {save|restore|check}" >&2
    exit 2
    ;;
esac
