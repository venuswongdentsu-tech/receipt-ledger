#!/bin/bash
T=$(cat /home/hermeswebui/.hermes/receipt-app-token)
echo "--- repo index.html (raw via API, no CDN) ---"
curl -s -H "Authorization: Bearer $T" -H 'Cache-Control: no-cache' \
  "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/contents/index.html" \
  | python3 -c "import sys,json,base64;d=json.load(sys.stdin);t=base64.b64decode(d['content']).decode();
import re
print('sha:',d['sha'][:10],'size:',d['size'])
print('v=24:',t.count('v=24'),'| vhProbe:',t.count('vhProbe'))
print(re.findall(r'介面版本 <b>v[0-9]+',t))"
echo "--- latest commits ---"
curl -s -H "Authorization: Bearer $T" \
  "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/commits?per_page=3" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);
[print(c['sha'][:7], c['commit']['message'].splitlines()[0]) for c in d]"
