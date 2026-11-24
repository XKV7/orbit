import sys, json, re, collections
src = open(sys.argv[1], encoding='utf-8-sig').read()
src = re.sub(r',(\s*[}\]])', r'\1', src)
src = re.sub(r'}\s*\n\s*{', '},\n{', src)
d = json.loads(src)
acts = d['actions']
print(collections.Counter(a['eventType'] for a in acts).most_common())
want = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else set()
for a in acts:
    if a['eventType'] in want:
        b = {k: v for k, v in a.items() if k not in ('eventType',)}
        print(a['eventType'], json.dumps(b, ensure_ascii=False)[:260])
