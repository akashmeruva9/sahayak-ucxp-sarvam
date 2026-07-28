#!/usr/bin/env bash
#
# Save / restore the hand-patched node_modules files the Android build needs.
# PLAN.md §7 #14 and #34.
#
# Android Studio launched from the Dock doesn't inherit the login shell PATH,
# and node lives under nvm. Fifteen Gradle/Kotlin files in node_modules were
# patched to read `System.getProperty("NODE_EXECUTABLE") ?: "node"` so the build
# can find it. Any `npm install` / `expo install` overwrites all fifteen.
#
#   ./scripts/android-patches.sh save      # before installing a dependency
#   npx expo install some-package
#   ./scripts/android-patches.sh restore   # put them back
#   ./scripts/android-patches.sh verify    # confirm all fifteen carry the marker
#
# Restore works from a recorded manifest, not a live search: once an install has
# overwritten the files the marker is gone, so there is nothing left to find.

set -euo pipefail

MARKER="NODE_EXECUTABLE"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
BACKUP="$FRONTEND/.android-patches"
MANIFEST="$BACKUP/manifest.txt"

die() { echo "error: $*" >&2; exit 1; }

# The patch lives in .gradle, .gradle.kts and .kt files. An earlier attempt
# matched only "*.gradle" and silently restored 5 of 15 — hence all three.
find_patched() {
  cd "$FRONTEND"
  grep -rl "$MARKER" node_modules \
    --include="*.gradle" --include="*.kts" --include="*.kt" 2>/dev/null | sort
}

cmd_save() {
  [ -d "$FRONTEND/node_modules" ] || die "no node_modules — nothing to save"
  local files count
  files="$(find_patched)"
  count="$(printf '%s' "$files" | grep -c . || true)"
  [ "$count" -gt 0 ] || die "found 0 patched files. Refusing to save an empty backup — \
the patches may already be gone, in which case restore from git or re-apply by hand."

  rm -rf "$BACKUP"; mkdir -p "$BACKUP"
  printf '%s\n' "$files" > "$MANIFEST"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$BACKUP/$(dirname "$f")"
    cp "$FRONTEND/$f" "$BACKUP/$f"
  done <<< "$files"
  echo "saved $count patched files → ${BACKUP#"$ROOT"/}"
}

cmd_restore() {
  [ -f "$MANIFEST" ] || die "no backup at ${BACKUP#"$ROOT"/} — run 'save' before installing"
  local restored=0 missing=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ -f "$BACKUP/$f" ]; then
      mkdir -p "$FRONTEND/$(dirname "$f")"
      cp "$BACKUP/$f" "$FRONTEND/$f"
      restored=$((restored + 1))
    else
      echo "  missing from backup: $f" >&2
      missing=$((missing + 1))
    fi
  done < "$MANIFEST"
  echo "restored $restored files${missing:+ ($missing missing)}"
  [ "$missing" -eq 0 ] || die "backup was incomplete"
  cmd_verify
}

cmd_verify() {
  local expected actual
  expected="$( [ -f "$MANIFEST" ] && grep -c . < "$MANIFEST" || echo 15 )"
  actual="$(find_patched | grep -c . || true)"
  if [ "$actual" -eq "$expected" ]; then
    echo "verify: $actual/$expected files carry the $MARKER patch ✓"
  else
    echo "verify: only $actual/$expected files carry the $MARKER patch ✗" >&2
    echo "        the Android build will fail with \"command 'node' not found\"" >&2
    exit 1
  fi
}

case "${1:-}" in
  save)    cmd_save ;;
  restore) cmd_restore ;;
  verify)  cmd_verify ;;
  *)       echo "usage: $0 {save|restore|verify}" >&2; exit 2 ;;
esac
