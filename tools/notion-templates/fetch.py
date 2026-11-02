import json,re,subprocess,sys
def post(host, path, body):
    r=subprocess.run(['curl','-s','-m','40','-X','POST',f'https://{host}/api/v3/{path}','-H','content-type: application/json','-d',json.dumps(body)],capture_output=True,text=True)
    try: return json.loads(r.stdout)
    except Exception: return {}
def dash(pid): return f"{pid[:8]}-{pid[8:12]}-{pid[12:16]}-{pid[16:20]}-{pid[20:]}"
def merge(rm, new):
    for table,rows in (new or {}).items():
        if not isinstance(rows,dict): continue
        rm.setdefault(table,{}).update(rows)
def unwrap(rec):
    v=rec.get('value',rec)
    if isinstance(v,dict) and 'value' in v and isinstance(v['value'],dict): v=v['value']
    return v
def load_page(url):
    pid=re.findall(r'([0-9a-f]{32})',url)[-1]; host=re.match(r'https://([^/]+)',url).group(1)
    rm={}; stack=[]; n=0
    while n<30:
        d=post(host,'loadPageChunk',{"page":{"id":dash(pid)},"limit":100,"cursor":{"stack":stack},"chunkNumber":n,"verticalColumns":False})
        merge(rm,d.get('recordMap')); stack=d.get('cursor',{}).get('stack',[]); n+=1
        if not stack: break
    return host,dash(pid),rm
if __name__=='__main__':
    host,pid,rm=load_page(sys.argv[1])
    print(host,pid,{k:len(v) for k,v in rm.items()})
    b=rm['block'][pid]; print(json.dumps(b)[:600])
    types={}
    for k,v in rm['block'].items():
        u=unwrap(v); types[u.get('type')]=types.get(u.get('type'),0)+1
    print(types)
