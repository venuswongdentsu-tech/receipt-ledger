#!/bin/bash
T=$(cat /home/hermeswebui/.hermes/receipt-app-token)
echo "--- commits (with dates) ---"
curl -s -H "Authorization: Bearer $T" -H 'Cache-Control: no-cache' \
  "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/commits?per_page=5" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);
[print(c['sha'][:7], c['commit']['committer']['date'], '|', c['commit']['message'].splitlines()[0]) for c in d]"
echo "--- pages build ---"
curl -s -H "Authorization: Bearer $T" -H 'Cache-Control: no-cache' \
  "https://api.github.com/repos/venuswongdentsu-tech/receipt-ledger/pages/builds/latest" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);
print(d.get('status'), d.get('created_at'), mid:='') if False else print('status:',d.get('status'),'| created:',d.get('created_at'),'| commit:',(d.get('commit') or '')[:7],'| err:',(d.get('error') or {}).get('message'))"
