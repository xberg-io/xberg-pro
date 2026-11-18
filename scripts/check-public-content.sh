#!/usr/bin/env bash
# Fails when published content names a customer, links the private repository, or exposes internal
# source paths, infrastructure or hostnames. Prints the number of files scanned so an empty scan is visible.
set -euo pipefail

cd "$(dirname "$0")/.."

patterns=(
  'zencity'
  'github\.com/xberg-io/xberg-enterprise'
  'xberg-enterprise#[0-9]+'
  '\bservices/[a-z0-9_-]+/(src|spec|tests|migrations|crates)\b'
  '\bfrontend/src/'
  '\bscripts/(ci|tests)/'
  'staging\.(enterprise\.)?xberg\.io'
  '\bpro\.staging\.'
  'boxwood-spirit'
  'frontend-(prod|staging)-[0-9a-f]{5}'
  'xberg-frontend-previews'
  'iter-1[01]'
  'LLM access is internal'
  'How we deploy Xberg Enterprise'
  '\.rs:[0-9]+'
  '\.ts:[0-9]+'
)

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(find README.md docs-site/src docs-site/public -type f \
  \( -name '*.md' -o -name '*.mdx' -o -name '*.astro' -o -name '*.yaml' -o -name '*.yml' -o -name '*.json' -o -name '*.txt' \))

if [ "${#files[@]}" -eq 0 ]; then
  echo "check-public-content: no files found to scan" >&2
  exit 1
fi

regex="$(
  IFS='|'
  echo "${patterns[*]}"
)"
if grep -nEiH "$regex" "${files[@]}"; then
  echo "check-public-content: private or internal references found (${#files[@]} files scanned)" >&2
  exit 1
fi
echo "check-public-content: ${#files[@]} files scanned, no private references"
