#!/bin/bash
T=$(cat /home/hermeswebui/.hermes/receipt-app-token)
echo "now: $(date -u +%H:%M:%S)"
for i in $(seq 1 10); do
  S=$(curl -s -H "Authorization: Bearer $T" -H 'Cache-Control: no-cache' \
    "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/pages/builds/latest" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'))")
  echo "build: $S"
  if [ "$S" = "built" ]; then break; fi
  sleep 20
done
echo "--- live check ---"
B="https://venuswongdentsu-tech.github.io/receipt-ledger"
H=$(curl -s -H 'Cache-Control: no-cache' "$B/index.html")
echo "live v=24: $(echo "$H" | grep -c 'v=24') | vhProbe: $(echo "$H" | grep -c vhProbe)"
echo "live app.js min-logic: $(curl -s -H 'Cache-Control: no-cache' "$B/app.js" | grep -c 'dh > 120 && dh < h')"
echo "live css body-white: $(curl -s -H 'Cache-Control: no-cache' "$B/style.css" | grep -c 'background:#fff')"
echo "live sw: $(curl -s -H 'Cache-Control: no-cache' "$B/sw.js" | grep -o 'ra-shell-v[0-9]*' | head -1)"
