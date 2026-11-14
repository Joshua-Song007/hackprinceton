#!/usr/bin/env bash
# Installs and checks everything the Omni agent loop needs on this laptop. Idempotent: run it again any time.
# usage: .agents/scripts/setup.sh <laptop-name> [--check]
#   --check  report only, install nothing
# macOS uses Homebrew (installed if missing, via Homebrew's official installer); Windows (Git Bash) uses winget.
# Cannot automate: the full Xcode app (App Store / Apple ID), `xcode-select --install` clicks, `gh auth login`, `claude` login.
set -uo pipefail
laptop=${1:?usage: setup.sh <laptop-name> [--check]}; mode=${2:-install}
[[ "$laptop" =~ ^[a-z0-9-]+$ ]] || { echo "laptop name must match [a-z0-9-]+" >&2; exit 2; }
case "$(uname -s)" in Darwin) plat=mac;; MINGW*|MSYS*|CYGWIN*) plat=win;; *) echo "unsupported OS: $(uname -s)" >&2; exit 2;; esac
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
miss=(); have() { command -v "$1" >/dev/null 2>&1; }
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  MISS  %s\n' "$1"; miss+=("$1"); }
need() {   # need <command> <brew package> <winget id>
  if have "$1"; then ok "$1"; return; fi
  if [ "$mode" = --check ]; then bad "$1"; return; fi
  echo "  installing $1 ..."
  if [ "$plat" = mac ]; then brew install "$2" >/dev/null 2>&1; else winget.exe install --id "$3" -e --silent --accept-package-agreements --accept-source-agreements >/dev/null 2>&1; fi
  if have "$1"; then ok "$1 (installed)"; else bad "$1 (install failed, or installed but not on PATH yet: open a new shell and rerun)"; fi
}
pyok() { for c in python3 python; do "$c" -c 'import json' >/dev/null 2>&1 && return 0; done; return 1; }

echo "Omni setup for '$laptop' on $plat ($mode)"
if [ "$plat" = mac ]; then
  echo "[toolchain]"
  if ! have brew; then
    if [ "$mode" = --check ]; then bad brew
    else echo "  installing Homebrew (official installer; may ask for your password) ..."; NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done; have brew && ok "brew (installed)" || bad brew; fi
  else ok brew; fi
  if xcode-select -p >/dev/null 2>&1; then ok "xcode command line tools"
  elif [ "$mode" = --check ]; then bad "xcode command line tools"
  else xcode-select --install 2>/dev/null; bad "xcode command line tools (a dialog opened: click Install, then rerun)"; fi
  sw=$(swift --version 2>/dev/null | grep -oE 'Swift version [0-9]+' | grep -oE '[0-9]+$')
  [ "${sw:-0}" -ge 6 ] && ok "swift $sw" || bad "swift 6+ (install Xcode 16+ from the App Store; this cannot be automated)"
  xc=$(xcodebuild -version 2>/dev/null | grep -oE 'Xcode [0-9]+' | grep -oE '[0-9]+$')
  [ "${xc:-0}" -ge 16 ] && ok "xcode $xc" || bad "Xcode 16+ (needed for the macOS 15 SDK)"
  need tmux tmux -
  have caffeinate && ok caffeinate || bad caffeinate
else
  echo "[toolchain] Windows: no Swift, no Xcode. This laptop runs the non-Swift lane only (see .agents/AGENTS.md Platform)."
  [ "$mode" = --check ] || git config --global core.longpaths true
  [ "$(git config --global core.longpaths)" = true ] && ok "git core.longpaths" || bad "git core.longpaths (run setup without --check)"
  echo "  note: set Windows sleep to Never while plugged in, or the loop pauses"
fi
echo "[tools]"
need gh gh GitHub.cli
need jq jq jqlang.jq
need node node OpenJS.NodeJS.LTS
pyok && ok "python (json)" || { [ "$mode" = --check ] && bad python || { if [ "$plat" = mac ]; then brew install python >/dev/null 2>&1; else winget.exe install --id Python.Python.3.12 -e --silent --accept-package-agreements --accept-source-agreements >/dev/null 2>&1; fi; pyok && ok "python (installed)" || bad "python (installed but not on PATH yet, or Windows Store stub: open a new shell and rerun)"; }; }
gv=$(git --version | grep -oE '[0-9]+\.[0-9]+' | head -1); [ "$(printf '%s\n2.31\n' "$gv" | sort -V | head -1)" = "2.31" ] && ok "git $gv" || bad "git 2.31+"
if have claude; then ok "claude $(claude --version 2>/dev/null | head -1)"
elif [ "$mode" = --check ]; then bad claude
else echo "  installing Claude Code (official installer) ..."; if [ "$plat" = mac ]; then curl -fsSL https://claude.ai/install.sh | bash; else powershell.exe -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"; fi; have claude && ok "claude (installed)" || bad "claude (not on PATH yet: open a new shell)"; fi
echo "[logins]"
gh auth status >/dev/null 2>&1 && ok "gh logged in" || bad "gh not logged in: run  gh auth login  (scope: repo)"
echo "[repo]"
case "$PWD" in *OneDrive*|*iCloud*|*Dropbox*) bad "repo is inside a synced folder ($PWD): clone it elsewhere, e.g. ~/hack/omni";; *) ok "repo location";; esac
echo
if [ "${#miss[@]}" -eq 0 ]; then echo "READY. Add to your shell profile:  export OMNI_LAPTOP=$laptop"; echo "Start the loop (inside tmux on a Mac):  caffeinate -i env OMNI_LAPTOP=$laptop .agents/scripts/loop.sh"; exit 0
else echo "NOT READY. ${#miss[@]} item(s) missing:"; printf '  - %s\n' "${miss[@]}"; exit 1; fi
