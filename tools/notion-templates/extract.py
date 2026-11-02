import json,re,sys,datetime,statistics
from fetch import post,dash,merge,unwrap,load_page

COLOR={'gray':'gray','brown':'brown','orange':'orange','yellow':'yellow','teal':'green','green':'green','blue':'blue','purple':'purple','pink':'pink','red':'red'}
MARKETING=re.compile(r'free templates?|\d+\+ ?(free )?templates|templates?:|more templates|get access|check out (my|our)|click here|link in bio|premium version|full version|paid version|unlock|support me|buy me|\$\d|gumroad|thank you for|get the |duplicate this|affiliate|buy |purchase|checkout|discount|coupon|follow me|instagram|etsy|ko-fi|patreon|subscribe|@\w+\.|upgrade|lifetime|bundle|my other templates|www\.|http',re.I)

def rich(title):
    out=''
    for seg in title or []:
        if not seg: continue
        t=seg[0]; fm=seg[1] if len(seg)>1 else []
        if t=='‣': 
            for f in fm:
                if f[0] in ('u','p'): pass
            t=''
        for f in fm or []:
            k=f[0]
            if k=='b': t=f'**{t}**' if t.strip() else t
            elif k=='i': t=f'*{t}*' if t.strip() else t
            elif k=='c': t=f'`{t}`' if t.strip() else t
            elif k=='s': t=f'~~{t}~~' if t.strip() else t
            elif k=='a' and len(f)>1 and str(f[1]).startswith('http'): t=t  # drop outbound links
        out+=t
    return out.replace('\n',' ').strip()

def plain(title): return ''.join(s[0] for s in (title or []) if s and s[0]!='‣').strip()

def get_rows(host, rm, cid, vid, sid):
    body={"collection":{"id":cid,"spaceId":sid},"collectionView":{"id":vid,"spaceId":sid},"source":{"type":"collection","id":cid,"spaceId":sid},"loader":{"reducers":{"collection_group_results":{"limit":40,"type":"results"}},"sort":[],"searchQuery":"","userTimeZone":"Europe/London","type":"reducer"}}
    d=post(host,'queryCollection',body)
    merge(rm,d.get('recordMap'))
    ids=(d.get('result',{}).get('reducerResults',{}).get('collection_group_results',{}).get('blockIds')) or []
    return ids

def convert_db(host, rm, cid, view_ids, sid, name_hint=''):
    col=unwrap(rm.get('collection',{}).get(cid,{}))
    schema=col.get('schema',{})
    props=[];ids={}
    title_id=next((k for k,v in schema.items() if v.get('type')=='title'),None)
    order=[title_id]+[k for k in schema if k!=title_id]
    for pid in order:
        v=schema[pid]; t=v.get('type'); nm=v.get('name','Name')
        m={'title':'title','text':'text','number':'number','select':'select','multi_select':'multi_select','status':'status','date':'date','checkbox':'checkbox','url':'url','email':'email','phone_number':'phone','person':'text','created_time':'created_time','last_edited_time':'last_edited_time'}.get(t)
        if not m: continue
        p={'name':nm,'type':m}
        if m in('select','multi_select','status'):
            opts=[o.get('value') for o in v.get('options',[]) if o.get('value')]
            if not opts and m!='status': 
                opts=[]
            p['options']=opts[:12]
            p['colors']=[o.get('color','default') for o in v.get('options',[])][:12]
        props.append(p); ids[pid]=p
    # views
    views=[]
    row_ids=[]
    for vid in view_ids[:5]:
        cv=unwrap(rm.get('collection_view',{}).get(vid,{}))
        vt=cv.get('type','table')
        if not row_ids:
            row_ids=get_rows(host,rm,cid,vid,sid)
        mapped={'table':'table','board':'board','gallery':'gallery','list':'list','calendar':'calendar','timeline':'calendar','chart':'table'}.get(vt,'table')
        view={'name':cv.get('name') or mapped.title(),'type':mapped}
        q=cv.get('query2',{}) or {}
        gb=q.get('group_by'); 
        if not gb:
            gb=(cv.get('format',{}) or {}).get('board_columns_by',{}) 
        if isinstance(gb,dict): gb=gb.get('property')
        if mapped=='board':
            if gb and gb in ids: view['group']=ids[gb]['name']
            else:
                g=next((p for p in props if p['type'] in('status','select')),None)
                if g: view['group']=g['name']
        if mapped=='calendar':
            cb=(cv.get('format',{}) or {}).get('calendar_by') or q.get('calendar_by')
            if cb in ids: view['date']=ids[cb]['name']
            else:
                dp=next((p for p in props if p['type']=='date'),None)
                if dp: view['date']=dp['name']
            if 'date' not in view: view['type']='table'
        if not any(v['name']==view['name'] and v['type']==view['type'] for v in views): views.append(view)
    if not views: views=[{'name':'Table','type':'table'}]
    # rows
    records=[]; dates=[]
    for rid in row_ids[:14]:
        r=unwrap(rm.get('block',{}).get(rid,{}))
        if not r or r.get('type')!='page': continue
        rp=r.get('properties',{})
        rec={}
        for pid,p in ids.items():
            raw=rp.get(pid)
            if raw is None: continue
            t=p['type']
            if t in('title','text','url','email','phone'): val=plain(raw)
            elif t=='number':
                try: val=float(plain(raw).replace(',','')) ; val=int(val) if val==int(val) else val
                except: val=None
            elif t in('select','status'): val=plain(raw)
            elif t=='multi_select': val=[x for x in plain(raw).split(',') if x.strip()]
            elif t=='checkbox': val=(plain(raw)=='Yes')
            elif t=='date':
                val=None
                for seg in raw:
                    for f in (seg[1] if len(seg)>1 else []):
                        if f[0]=='d': 
                            sd=f[1].get('start_date'); 
                            if sd: val={'date':sd}; dates.append(sd)
            else: val=None
            if val not in (None,'',[]) : rec[p['name']]=val
        if rec: records.append(rec)
    # shift dates around today
    if dates:
        ds=sorted(datetime.date.fromisoformat(d[:10]) for d in dates)
        anchor=ds[len(ds)//2]
        for rec in records:
            for k,v in list(rec.items()):
                if isinstance(v,dict) and 'date' in v:
                    rec[k]={'offsetDays':(datetime.date.fromisoformat(v['date'][:10])-anchor).days}
    for p in props: pass
    return {'name':(col.get('name') and plain(col['name'])) or name_hint or 'Database','properties':props,'records':records,'views':views}

def convert(host, rm, pid):
    blocks_rm=rm['block']
    dbs=[]
    def B(bid):
        return unwrap(blocks_rm.get(bid,{}))
    def sid_of(bid): return (blocks_rm.get(bid) or {}).get('spaceId') or ''
    def conv(bid, depth=0):
        b=B(bid)
        if not b: return []
        t=b.get('type'); pr=b.get('properties',{}); fm=b.get('format',{}) or {}
        text=rich(pr.get('title'))
        kids=lambda: [x for c in (b.get('content') or []) for x in conv(c,depth+1)]
        if t in('text',):
            if not text: return [{'type':'text','text':''}]
            if MARKETING.search(text): return []
            return [{'type':'text','text':text if len(text)<=140 else ''}]
        if t=='header': return [{'type':'h1','text':text}]
        if t=='sub_header': return [{'type':'h2','text':text}]
        if t=='sub_sub_header': return [{'type':'h3','text':text}]
        if t=='bulleted_list': return [{'type':'bulleted','text':text if len(text)<=100 else ''}]+kids()
        if t=='numbered_list': return [{'type':'numbered','text':text if len(text)<=100 else ''}]+kids()
        if t=='to_do': return [{'type':'todo','text':text if len(text)<=100 else '','props':{'checked':False}}]
        if t=='toggle': return [{'type':'toggle','text':text,'props':{'collapsed':False},'children':kids()}]
        if t=='quote': return [{'type':'quote','text':text if len(text)<=140 else ''}]
        if t=='divider': return [{'type':'divider','text':''}]
        if t=='callout':
            if MARKETING.search(text): return []
            icon=fm.get('page_icon') or '💡'
            if str(icon).startswith('/') or str(icon).startswith('http'): icon='💡'
            col=COLOR.get((fm.get('block_color') or 'gray').split('_')[0],'gray')
            return [{'type':'callout','text':text if len(text)<=160 else '','props':{'icon':icon,'color':col},'children':kids()}]
        if t=='code': return [{'type':'code','text':plain(pr.get('title'))[:400],'props':{'language':(plain(pr.get('language')) or 'plain text').lower()}}]
        if t=='column_list':
            cols=[]
            for c in b.get('content') or []:
                cb=B(c)
                if cb.get('type')=='column': cols.append([x for cc in (cb.get('content') or []) for x in conv(cc,depth+1)])
            cols=[c for c in cols if c]
            return [{'type':'columns','text':'','columns':cols}] if len(cols)>1 else [x for c in cols for x in c]
        if t=='table':
            rows=[]; order=fm.get('table_block_column_order') or []
            for rid in b.get('content') or []:
                rb=B(rid); rp=rb.get('properties',{})
                rows.append([plain(rp.get(c)) for c in order])
            if rows: return [{'type':'table','text':'','props':{'rows':rows[:12],'hasHeader':bool(fm.get('table_block_column_header'))}}]
            return []
        if t=='table_of_contents': return [{'type':'toc','text':''}]
        if t in('collection_view','collection_view_page'):
            cid=b.get('collection_id') or (fm.get('collection_pointer') or {}).get('id')
            vids=b.get('view_ids') or []
            if not cid or not vids: return []
            db=convert_db(host,rm,cid,vids,sid_of(bid) or (fm.get('collection_pointer') or {}).get('spaceId',''),text)
            if not db['records'] and len(db['properties'])<2: return []
            dbs.append(db)
            return [{'type':'database','text':'','dbIndex':len(dbs)-1}]
        if t in('synced_container','transclusion_container','toggle_header'): return kids()
        return []
    root=B(pid)
    fm=root.get('format',{}) or {}
    icon=fm.get('page_icon') or ''
    if icon.startswith('/') or icon.startswith('http'): icon=''
    out=[]
    if root.get('type')=='collection_view_page':
        out=conv(pid)
    else:
        for c in root.get('content') or []: out+=conv(c)
    return {'name':plain(root.get('properties',{}).get('title')) or 'Template','emoji':icon,'blocks':out,'databases':dbs}

def score(rm,pid):
    n=0
    for k,v in rm['block'].items():
        t=unwrap(v).get('type'); n+=1
        if t in('collection_view','collection_view_page'): n+=10
    return n

def clone(url):
    host,pid,rm=load_page(url)
    sc=score(rm,pid)
    if sc<14:
        # landing page: follow into the child page with the most content
        kids=[c for c in (unwrap(rm['block'].get(pid,{})).get('content') or [])]
        best=None
        for k,v in list(rm['block'].items()):
            u=unwrap(v)
            if u.get('type') in('page','collection_view_page') and k!=pid and (u.get('content') or u.get('type')=='collection_view_page'):
                size=len(u.get('content') or [])+(20 if u.get('type')=='collection_view_page' else 0)
                if not best or size>best[0]: best=(size,k)
        if best:
            nm=lambda: None
            rm2={'block':{}}
            # load child page chunks
            stack=[];n=0;rm_child={}
            while n<30:
                d=post(host,'loadPageChunk',{"page":{"id":best[1]},"limit":100,"cursor":{"stack":stack},"chunkNumber":n,"verticalColumns":False})
                merge(rm_child,d.get('recordMap')); stack=d.get('cursor',{}).get('stack',[]); n+=1
                if not stack: break
            if score(rm_child,best[1])>sc: rm,pid=rm_child,best[1]
    return convert(host,rm,pid),score(rm,pid)

if __name__=='__main__':
    spec,sc=clone(sys.argv[1])
    print(spec['name'],sc,len(spec['blocks']),len(spec['databases']))
    print(json.dumps(spec,indent=1)[:2500])
