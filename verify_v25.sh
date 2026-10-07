#!/bin/bash
T=$(cat /home/hermeswebui/.hermes/receipt-app-token)
B="https://venuswongdentsu-tech.github.io/receipt-ledger"
echo "now: $(date -u +%H:%M:%S)"
for i in $(seq 1 12); do
  S=$(curl -s -H "Authorization: Bearer $T" -H 'Cache-Control: no-cache' \
      "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/pages/builds/latest" \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'),d.get('created_at'))" 2>/dev/null)
  H=$(curl -s -H 'Cache-Control: no-cache' "$B/index.html")
  if echo "$H" | grep -q 'v=25'; then
    echo "== LIVE v25 =="
    echo "index.html  v=25: $(echo "$H" | grep -o 'v=25' | head -1) | tab SVG: $(echo "$H" | grep -c '<svg class="ico"')"
    CSS=$(curl -s -H 'Cache-Control: no-cache' "$B/style.css")
    echo "style.css   頁面底 #f0f1f3: $(echo "$CSS" | grep -c '#f0f1f3') | 零藍色(#1f3864): $(echo "$CSS" | grep -c '#1f3864') | 白圓掣: $(echo "$CSS" | grep -c 'background:#fff;')"
    JS=$(curl -s -H 'Cache-Control: no-cache' "$B/app.js")
    echo "app.js      ⏳ emoji: $(echo "$JS" | grep -c '⏳') | 狀態點 ●: $(echo "$JS" | grep -c 'textContent = "●"') | min(dvh): $(echo "$JS" | grep -c 'visualViewport')"
    SW=$(curl -s -H 'Cache-Control: no-cache' "$B/sw.js")
    echo "sw.js       cache: $(echo "$SW" | grep -o "ra-shell-v[0-9]*" | head -1)"
    echo "build: $S"
    exit 0
  fi
  echo "[$i] build=$S live 仲係舊版，等 20s..."
  sleep 20
done
echo "12 次都未見 v25（CDN 未更新）"; exit 1
