#!/bin/bash
B="https://venuswongdentsu-tech.github.io/receipt-ledger"
for i in 1 2 3 4 5 6 7 8; do
  H=$(curl -s -H 'Cache-Control: no-cache' "$B/index.html")
  if echo "$H" | grep -q 'v=24'; then
    echo "LIVE v24 OK (try $i)"
    echo "  vhProbe: $(echo "$H" | grep -c vhProbe)"
    echo "  verline: $(echo "$H" | grep -o '介面版本 <b>v[0-9]*' | head -1)"
    AJ=$(curl -s -H 'Cache-Control: no-cache' "$B/app.js")
    echo "  min-logic: $(echo "$AJ" | grep -c 'dh > 120 && dh < h')"
    echo "  old-screen-height-branch(expect 0): $(echo "$AJ" | grep -c 'sc - h < 140')"
    CS=$(curl -s -H 'Cache-Control: no-cache' "$B/style.css")
    echo "  body-white: $(echo "$CS" | grep -c 'background:#fff')"
    echo "  views-grey: $(echo "$CS" | grep -c 'background:var(--bg)')"
    echo "  probe-css: $(echo "$CS" | grep -c 'vhProbe')"
    echo "  sw: $(curl -s -H 'Cache-Control: no-cache' "$B/sw.js" | grep -o 'ra-shell-v[0-9]*' | head -1)"
    exit 0
  fi
  echo "try $i: CDN stale, sleep 30"; sleep 30
done
echo "TIMEOUT: live 仍舊版"
exit 1
