#!/bin/bash
B="https://venuswongdentsu-tech.github.io/receipt-ledger"
H='Cache-Control: no-cache'
for i in 1 2 3 4 5; do
  V=$(curl -s -H "$H" "$B/index.html" | grep -o 'v2[0-9]' | head -1)
  echo "第 $i 次: index 版本 = $V"
  [ "$V" = "v23" ] && break
  sleep 60
done
echo "--- 逐項 ---"
echo "app.js edform: $(curl -s -H "$H" "$B/app.js" | grep -c 'class="edform"')"
echo "app.js 編輯彈層 hint（應為 0）: $(curl -s -H "$H" "$B/app.js" | grep -c "edBody\").innerHTML = fieldGrid(edDraft);")"
echo "app.js product_original 儲存鍵: $(curl -s -H "$H" "$B/app.js" | grep -c 'product_original", "qty')"
echo "style.css .edrow: $(curl -s -H "$H" "$B/style.css" | grep -c '\.edrow')"
echo "sw.js: $(curl -s -H "$H" "$B/sw.js" | grep -o 'ra-shell-v2[0-9]')"
