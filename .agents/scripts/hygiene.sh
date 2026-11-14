#!/usr/bin/env bash
# PR hygiene checks. Run by .github/workflows/hygiene.yml on every pull request, and by hand before a push. Read-only.
# Exits 1 when any check fails, 2 on a usage error.
set -uo pipefail
cd "$(dirname "$0")/../.."

usage() {
  cat <<'EOF'
usage: .agents/scripts/hygiene.sh [--base REF] [--branch NAME] [--body-file FILE] [--strict]

Checks (read-only):
  branch   an agent/* branch is named agent/<laptop>/<slug> (lowercase, digits, - . _)
  refs     an agent/* PR body has a line starting "Refs #<n>" (needs --body-file or $PR_BODY)
  added    no .build/, Backend/target/, .env, key/certificate or credentials file is added,
           and no private key or token-shaped string is in an added line (diff vs --base)
  parse    every tracked *.json parses; every tracked *.yml / *.yaml parses (needs PyYAML)
  shell    bash -n and shellcheck -S error on .agents/scripts/*.sh
  docs     .agents/scripts/check-docs.sh

  --base REF        diff base (default origin/main)
  --branch NAME     head branch (default $GITHUB_HEAD_REF, else the current branch)
  --body-file FILE  PR body; without it (and without $PR_BODY) refs is skipped
  --strict          a missing PyYAML, shellcheck or PR body fails instead of skipping (CI sets this)
EOF
}

base=origin/main; branch=${GITHUB_HEAD_REF:-}; body_file=""; strict=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base=${2:?--base needs a ref}; shift 2 ;;
    --branch) branch=${2:?--branch needs a name}; shift 2 ;;
    --body-file) body_file=${2:?--body-file needs a file}; shift 2 ;;
    --strict) strict=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "hygiene: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$branch" ] || branch=$(git branch --show-current 2>/dev/null || true)

bad=0
ok()   { echo "  ok   $1"; }
skip() { echo "  skip $1"; }
fail() { echo "  FAIL $1"; bad=1; }
missing() { if [ "$strict" -eq 1 ]; then fail "$1 (required with --strict)"; else skip "$1"; fi; }

echo "== branch"
case "$branch" in
  agent/*)
    if printf '%s\n' "$branch" | grep -qE '^agent/[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9._-]*$'; then ok "$branch"
    else fail "$branch does not match agent/<laptop>/<slug>"; fi ;;
  "") skip "no branch name (detached HEAD)" ;;
  *) skip "$branch is not an agent branch" ;;
esac

echo "== refs"
body=""
if [ -n "$body_file" ]; then
  [ -f "$body_file" ] || { echo "hygiene: no such file: $body_file" >&2; exit 2; }
  body=$(cat "$body_file")
elif [ -n "${PR_BODY:-}" ]; then
  body=$PR_BODY
fi
case "$branch" in
  agent/*)
    if [ -z "$body_file" ] && [ -z "${PR_BODY:-}" ]; then missing "no PR body given"
    elif printf '%s\n' "$body" | tr -d '\r' | grep -qE '^[[:space:]]*Refs #[0-9]+'; then ok "PR body has a Refs #<n> line"
    else fail "PR body has no line starting 'Refs #<n>'"; fi ;;
  *) skip "not an agent branch" ;;
esac

echo "== added"
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  fail "base $base not found (git fetch origin first)"
else
  added=$(git diff --name-only --diff-filter=A "$base"...HEAD 2>/dev/null)
  # Paths that are build output or look like secrets. .env.example / .env.sample are allowed.
  path_re='(^|/)\.build/|^Backend/target/|(^|/)\.env$|(^|/)\.env\.|\.(pem|key|p8|p12|pfx|keystore|jks|mobileprovision)$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|(^|/)\.netrc$|(^|/)credentials(\.json)?$|(^|/)secrets?\.(json|ya?ml|toml|env)$'
  hits=$(printf '%s\n' "$added" | grep -E "$path_re" | grep -vE '\.env\.(example|sample)$' || true)
  if [ -n "$hits" ]; then fail "added build output or secret-looking files:"; printf '%s\n' "$hits" | sed 's/^/         /'
  else ok "$(printf '%s\n' "$added" | grep -c . ) added file(s), none is build output or secret-looking"; fi
  # Written in pieces so this file does not match its own patterns.
  key_re='BEGIN [A-Z ]*PRIVATE'' KEY|gh[pousr]_[A-Za-z0-9]{36}|github_pa[t]_[A-Za-z0-9_]{22,}|sk-an[t]-[A-Za-z0-9_-]{20,}|AKI[A][0-9A-Z]{16}|xox[b]-[0-9A-Za-z-]{20,}'
  lines=$(git diff -U0 "$base"...HEAD 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+ ' | grep -cE "$key_re" || true)
  if [ "${lines:-0}" -gt 0 ]; then fail "$lines added line(s) look like a private key or token (git diff -U0 $base...HEAD)"
  else ok "no key or token-shaped string in added lines"; fi
fi

echo "== parse"
py=""; for c in python3 python; do "$c" -c 'import json' >/dev/null 2>&1 && { py=$c; break; }; done
if [ -z "$py" ]; then
  missing "python not found, JSON / YAML not parsed"
else
  files=$(git ls-files -- '*.json' '*.yml' '*.yaml')
  # shellcheck disable=SC2086  # tracked paths here have no spaces
  out=$("$py" - "$strict" $files <<'PY'
import json, sys
strict = sys.argv[1] == "1"
try:
    import yaml
except ImportError:
    yaml = None
bad = n_json = n_yaml = 0
for p in sys.argv[2:]:
    try:
        with open(p, encoding="utf-8") as f:
            if p.endswith(".json"):
                json.load(f); n_json += 1
            elif yaml is not None:
                yaml.safe_load(f); n_yaml += 1
    except Exception as e:
        print("FAIL %s: %s" % (p, str(e).splitlines()[0] if str(e) else type(e).__name__)); bad = 1
print("JSON %d" % n_json)
print("YAML %d" % n_yaml if yaml is not None else "NOYAML")
sys.exit(bad)
PY
)
  rc=$?
  printf '%s\n' "$out" | grep '^FAIL ' | while IFS= read -r l; do echo "  $l"; done
  [ "$rc" -eq 0 ] || bad=1
  njson=$(printf '%s\n' "$out" | sed -n 's/^JSON //p')
  [ "$rc" -eq 0 ] && ok "${njson:-0} JSON file(s) parse"
  if printf '%s\n' "$out" | grep -q '^NOYAML'; then missing "PyYAML not installed, YAML not parsed"
  elif [ "$rc" -eq 0 ]; then ok "$(printf '%s\n' "$out" | sed -n 's/^YAML //p') YAML file(s) parse"; fi
fi

echo "== shell"
syn=0
for s in .agents/scripts/*.sh; do bash -n "$s" 2>/dev/null || { fail "bash -n $s"; syn=1; }; done
[ "$syn" -eq 0 ] && ok "bash -n on .agents/scripts/*.sh"
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -S error .agents/scripts/*.sh; then ok "shellcheck -S error"; else fail "shellcheck -S error"; fi
else
  missing "shellcheck not installed"
fi

echo "== docs"
if bash .agents/scripts/check-docs.sh >/dev/null 2>&1; then ok "check-docs.sh"
else fail "check-docs.sh:"; bash .agents/scripts/check-docs.sh | sed 's/^/         /'; fi

echo
if [ "$bad" -eq 0 ]; then echo "hygiene: OK"; else echo "hygiene: FAILED"; exit 1; fi
