import json,re,sys,os
from extract import clone
T=json.load(open('/tmp/notion_templates.json'))
have=set(f[:-5] for f in os.listdir('out') if f.endswith('.json') and not f.startswith('_'))
AI=re.compile(r'^(Turn|Find|Create Action|Proofread|Connect the|Remove Dup|Reformat|Simplify|Translate|SOP from|PRD from|Content brief|AI |Resume Gap|Argument|Summar|Improve|Rewrite|Fix|Make |Generate|Extract|Analy[sz]e|Draft|Write|Review|Classify|Detect|Compare|Convert)',re.I)
SKIP=re.compile(r'aesthetic|kawaii|pixel|widget|christmas|smiski|kuchipatchi|girly|supergirl|nightwing|damian|van gogh|forest|snowy|pink|cozy|ultimate|bundle|os\b|studio|brand|pitch deck|terms|careers page|landing|sew|dating|region',re.I)
picks=[t for t in T if t['slug'] not in have and not AI.search(t['name'].strip()) and not SKIP.search(t['name']) and t['made_by']!='notion'][:150]
print(len(picks),flush=True)
for t in picks:
    try:
        spec,sc=clone(t['url'])
        spec['source']={'name':t['name'].strip(),'slug':t['slug'],'made_by':t['made_by'],'desc':t['desc'][:200]}
        json.dump(spec,open(f"out/{t['slug']}.json",'w'))
        print('OK',t['name'][:40],'score',sc,'blocks',len(spec['blocks']),'dbs',len(spec['databases']),flush=True)
    except Exception as e:
        print('FAIL',t['name'][:40],repr(e)[:80],flush=True)
