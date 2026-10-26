#!/usr/bin/env bash
# Probes candidate CC/public test MP4s. Emits one GitHub annotation per
# candidate (HTTP status, content-type, and first magic bytes) and exits 0
# only if at least one candidate is a genuine, reachable MP4 (ftyp box).
set -u

CANDIDATES=(
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
  "https://vjs.zencdn.net/v/oceans.mp4"
  "https://media.w3.org/2010/05/sintel/trailer.mp4"
  "https://mdn.github.io/shared-assets/videos/flower.mp4"
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4"
)

ok_count=0
winner=""

for u in "${CANDIDATES[@]}"; do
  tmp="$(mktemp)"
  # First 16 bytes: enough to see the ftyp box if this is a real MP4.
  read -r code ctype < <(curl -sL --max-time 25 --range 0-31 \
      -H 'User-Agent: Mozilla/5.0 (compatible; MediaFetch-CI/1.0)' \
      -o "$tmp" -w '%{http_code} %{content_type}' "$u" 2>/dev/null || echo "000 error")
  magic="$(head -c 16 "$tmp" | xxd -p 2>/dev/null | tr -d '\n')"
  box="$(head -c 16 "$tmp" | dd bs=1 skip=4 count=4 2>/dev/null)"
  status="FAIL"
  if [ "$code" = "200" ] || [ "$code" = "206" ]; then
    if [ "$box" = "ftyp" ]; then
      status="OK"
      ok_count=$((ok_count + 1))
      [ -z "$winner" ] && winner="$u"
    else
      status="NOT-MP4"
    fi
  fi
  echo "::notice title=E2E asset::${status} ${u} → HTTP ${code}, type=${ctype}, magic=${magic}"
  echo "asset ${status}: ${u} HTTP ${code} type=${ctype} box=${box}"
  rm -f "$tmp"
done

if [ "$ok_count" -eq 0 ]; then
  echo "::error title=E2E asset::No candidate sample MP4 is reachable — update scripts/probe-e2e-assets.sh and tests/e2e/ui.spec.js"
  exit 1
fi
echo "WINNER=${winner}"
