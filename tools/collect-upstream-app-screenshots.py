#!/usr/bin/env python3
"""Curate genuine screenshots from upstream application source READMEs.

Never synthesize images, invent screens, or screenshot Clyra and claim it is
another app. Keep every existing app screenshot as-is, and skip any app
that ALREADY has at least three screenshots. Only use verified image bytes
published by the upstream app's authors, or clearly labeled official demos.
"""
from __future__ import annotations
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from io import BytesIO
import json
import os
from pathlib import Path
import re
import time
import subprocess
import tempfile
from urllib.parse import urlparse, urljoin, quote, unquote
from urllib.request import Request, urlopen
from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/library-shots"
REGISTRY = ROOT / "lib/clyra-code/library/registry.ts"
OUTPUT = ROOT / "lib/clyra-code/library/upstream-app-screenshots.ts"
REPORT = ROOT / "app-screenshot-coverage.json"
TOKEN = os.getenv("GITHUB_TOKEN", "")
MAX_BYTES = 10 * 1024 * 1024
MAX_PER_APP = 3

# These are preserved as the FIRST existing screenshots; no overwrite or
# re-ordering. Astrofy already has three distinct verified captures.
EXISTING = {"astrofy": 3, "minipaint": 1, "uptime-kuma": 1}

# First-party images identified in the project's own README or docs.
# The image pipeline also searches every live source repository's README.
PREFERRED = {
    # OpenCluely's assests/*.png were visually inspected: they are OS icons,
    # NOT application screenshots. Never pass them off as app previews.
    "openfilm": [("docs/openfilm.webp", "OpenFilm editor workflow")],
    "openhands": [
        ("https://assets.openhands.dev/screenshot/automation-preview.png", "OpenHands automation interface"),
        ("https://github.com/user-attachments/assets/cb6de6f5-ac30-4d04-a76a-b5c259f0c163", "OpenHands agent workspace"),
    ],
    "svgedit": [("docs/screenshot.png", "SVGEdit vector editing workspace")],
    "kdenlive": [
        ("https://docs.kdenlive.org/en/_images/timeline-overhaul.png", "Kdenlive timeline editor"),
        ("https://docs.kdenlive.org/en/_images/timeline-video_track_right_click-2608.webp", "Kdenlive editing track controls"),
        ("https://docs.kdenlive.org/en/_images/kdenlive_timeline_ruler.webp", "Kdenlive timeline ruler"),
        ("https://docs.kdenlive.org/en/_images/monitor-preview_resolution-2512.webp", "Kdenlive preview monitor"),
    ],
    "natron": [
        ("https://natron.readthedocs.io/en/rb-2.6/_images/node_viewer_nodetree.gif", "Natron viewer and node graph"),
        ("https://natron.readthedocs.io/en/rb-2.6/_images/node_image_write_nodetree.jpg", "Natron output and compositing nodes"),
        ("https://natron.readthedocs.io/en/rb-2.6/_images/node_image_write_render.gif", "Natron render controls"),
        ("https://natron.readthedocs.io/en/rb-2.6/_images/proppanel_blur_03.png", "Natron effect properties"),
    ],
    "krita": [
        ("https://docs.krita.org/en/_images/Krita_multiple_views.png", "Krita canvas with multiple views"),
        ("https://docs.krita.org/en/_images/Dockers.png", "Krita layers and tool dockers"),
        ("https://docs.krita.org/en/_images/Multi-window.png", "Krita multiple editor windows"),
        ("https://docs.krita.org/en/_images/Canvas-krita.png", "Krita painting canvas"),
    ],
    "plane": [
        ("https://media.docs.plane.so/GitHub-readme/github-work-items.webp", "Plane work item view"),
        ("https://media.docs.plane.so/GitHub-readme/github-cycles.webp", "Plane cycle planning"),
        ("https://media.docs.plane.so/GitHub-readme/github-views.webp", "Plane project views"),
        ("https://media.docs.plane.so/GitHub-readme/github-analytics.webp", "Plane analytics dashboard"),
    ],
    "penpot": [
        ("https://github.com/user-attachments/assets/da17b160-f289-436f-b140-972083a08602", "Penpot UI example 1"),
        ("https://github.com/user-attachments/assets/cce75ad6-f783-473f-8803-da9eb8255fef", "Penpot UI example 2"),
        ("https://github.com/user-attachments/assets/243e796e-a140-481a-b68f-b24be6a70e37", "Penpot UI example 3"),
    ],
    "uptime-kuma": [
        ("https://uptime.kuma.pet/img/light.jpg", "Uptime Kuma dashboard"),
        ("https://louislam.net/uptimekuma/2.jpg", "Uptime Kuma monitors"),
        ("https://louislam.net/uptimekuma/3.jpg", "Uptime Kuma status page"),
    ],
}

def fetch(url: str, *, is_api=False) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1"}:
        raise ValueError("Rejected non-public URL")
    headers = {"User-Agent": "Clyra-source-screenshot-audit/1.0", "Accept": "application/vnd.github+json" if is_api else "image/*"}
    if TOKEN and parsed.hostname == "api.github.com":
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = Request(url, headers=headers)
    with urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise ValueError(f"HTTP {resp.status}")
        data = resp.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("Image or README exceeds size limit")
        return data

def readme(repo: str) -> tuple[str,str]:
    info=json.loads(fetch(f"https://api.github.com/repos/{repo}", is_api=True))
    branch=info["default_branch"]
    obj=json.loads(fetch(f"https://api.github.com/repos/{repo}/readme", is_api=True))
    content=base64.b64decode(obj["content"]).decode("utf-8", errors="replace")
    return branch, content

def screenshots_from_readme(content: str) -> list[tuple[str,str]]:
    markdown = [(m.group(2),m.group(1)) for m in re.finditer(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+["\'][^)]*["\'])?\)',content)]
    html = [(m.group(1),m.group(2)) for m in re.finditer(r'<img\b(?=[^>]*\bsrc=["\']([^"\']+)["\'])(?=[^>]*\balt=["\']([^"\']*)["\'])[^>]*>',content,re.I)]
    html += [(m.group(1),"") for m in re.finditer(r'<img\b[^>]*\bsrc=["\']([^"\']+)["\']',content,re.I)]
    found, seen = [],set()
    for url, alt in markdown + html:
        url = url.strip().split("#")[0]
        label=(url+" "+alt).lower()
        if any(word in label for word in ["shield", "badge", "repobeats", "contrib.rocks", "star-history", "github/actions", "travis", "sponsor", "donate", "buymeacoffee", "logo", "github-profile", "discord", "weblate", "docker-logo", "github/workflows", "opengraph", "og-image", "social_preview", "social-preview", "sponsor", "account-avatar", "icon-360creators", "bsky.app/img/avatar", "banner.jpg", "branding/"]):
            continue
        if url.lower().endswith((".svg",".svg?")):continue
        if url in seen:continue
        seen.add(url)
        found.append((url,alt or Path(urlparse(url).path).stem.replace("-"," ").replace("_"," ")))
    return found

def normalize(url: str, repo: str, branch: str) -> str:
    url=url.strip().replace("&amp;","&")
    if url.startswith("http://"):url="https://"+url[7:]
    if url.startswith("//"):url="https:"+url
    if url.startswith("https://github.com/") and "/blob/" in url:
        url=url.replace("https://github.com/", "https://raw.githubusercontent.com/",1).replace("/blob/","/",1)
    if url.startswith("https://"):return url
    # Leading /image.png in a GitHub README denotes a repo-relative asset.
    return f"https://raw.githubusercontent.com/{repo}/{branch}/{url[2:] if url.startswith('./') else url.lstrip('/')}"

def frames_from_official_opencluely_video():
    """Real UI frames from the video linked directly under the upstream README Demo heading."""
    source="https://github.com/user-attachments/assets/896a7140-1e85-405d-bfbe-e05c9f3a816b"
    try:
        req=Request(source,headers={"User-Agent":"Clyra-source-screenshot-audit/1.0"})
        with urlopen(req,timeout=28) as r:
            video=r.read(75*1024*1024+1)
        if len(video)>75*1024*1024 or len(video)<30_000:
            raise ValueError("Unexpectedly small or large upstream demo video")
        with tempfile.NamedTemporaryFile(suffix=".mp4") as temp:
            temp.write(video);temp.flush()
            duration=float(subprocess.check_output(
                ["ffprobe","-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",temp.name],
                timeout=18,text=True).strip())
            if not 2<duration<1200:
                raise ValueError(f"Unexpected video duration: {duration}")
            frames=[]
            for fraction in [0.10,0.28,0.47,0.65,0.83,0.94]:
                rawframe=subprocess.check_output(
                    ["ffmpeg","-hide_banner","-loglevel","error","-ss",str(duration*fraction),"-i",temp.name,"-frames:v","1","-f","image2pipe","-vcodec","mjpeg","-q:v","3","pipe:1"],timeout=35)
                frames.extend(candidate_frames(rawframe,f"OpenCluely live desktop demo at {int(duration*fraction)}s"))
            return source, frames
    except Exception as exc:
        return source, []


def candidate_frames(raw: bytes, label: str):
    try:
        with Image.open(BytesIO(raw)) as image:
            n=getattr(image,"n_frames",1)
            indices=[0] if n < 8 else [max(0, int(n*f)) for f in [0.15,0.5,0.83]]
            frames=[]
            for index in indices:
                image.seek(index)
                frame=ImageOps.exif_transpose(image).convert("RGB")
                w,h=frame.size
                if w<380 or h<215:continue
                if ImageStat.Stat(frame.convert("L").resize((64,42))).stddev[0]<8:continue
                out=ImageOps.contain(frame,(1200,750),Image.Resampling.LANCZOS)
                bg=Image.new("RGB",(1200,750),(248,248,247))
                bg.paste(out,((1200-out.width)//2,(750-out.height)//2))
                frames.append((bg,f"{label}{' — frame '+str(index) if n>1 else ''}"))
            return frames
    except (OSError,UnidentifiedImageError,ValueError):
        return []

def difference(a: Image.Image,b:Image.Image) -> float:
    x=list(a.resize((32,20)).convert("L").getdata())
    y=list(b.resize((32,20)).convert("L").getdata())
    return sum(abs(p-q) for p,q in zip(x,y))/len(x)

def get_sources() -> list[tuple[str,str]]:
    content=REGISTRY.read_text(encoding="utf-8")
    # Parse live source seeds only; FULL_SEEDS are out-of-scope/inactive.
    active=content.split("const seeds: readonly Seed[] = [",1)[1].split("...LANDING_PAGE_SOURCES.map",1)[0]
    items=re.findall(r'^\s*\["([^"]+)",\s*"[^"]+",\s*"[^"]*",\s*"[^"]*",\s*"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"',active,re.M)
    if len(items)!=56 or len(set(id for id,_ in items))!=56:
        raise RuntimeError(f"Expected 56 non-landing apps, found {len(items)}")
    return items

def collect(item: tuple[str,str]) -> tuple[str,list[dict],str|None]:
    id,repo=item
    if EXISTING.get(id,0)>=3:return id,[],"Already has 3 original screenshots; deliberately untouched"
    need=3-EXISTING.get(id,0)
    warnings=[]
    try:
        branch,body=readme(repo)
    except Exception as e:
        # Curated direct paths are still usable if README API is unavailable.
        branch="main";body="";warnings.append(f"README: {str(e)[:110]}")
    candidates=PREFERRED.get(id,[])+screenshots_from_readme(body)
    # OpenCluely's README publishes an actual demonstration VIDEO rather than
    # screenshots. Extract real, separated video frames, never fake icons.
    if id == "opencluely":
        origin, video_images = frames_from_official_opencluely_video()
        accepted, previews = [], []
        for image, caption in video_images:
            if any(difference(image,other)<7.5 for other in previews):continue
            previews.append(image)
            file=f"app-opencluely-source-{len(accepted)+1}.jpg"
            dest=ASSETS/file
            if not dest.exists():image.save(dest,quality=83,optimize=True,progressive=True)
            if dest.stat().st_size<8000:continue
            accepted.append({"file":file,"alt":caption+" (real upstream demo video frame)","origin":origin})
            if len(accepted)>=need:break
        if len(accepted)>=need:return id,accepted,None
        warnings.append(f"Upstream demo yielded only {len(accepted)} distinct frames")

    seenURLs=set();found=[];frames=[]
    for value,label in candidates[:25]:
        try:
            url=normalize(value,repo,branch)
            if url in seenURLs:continue
            seenURLs.add(url)
            raw=fetch(url)
            pics=candidate_frames(raw,label.strip()[:90] or "Upstream screenshot")
            for img,caption in pics:
                if any(difference(img,prior)<7.5 for prior in frames):continue
                frames.append(img)
                name=f"app-{id}-source-{len(found)+1}.jpg"
                dst=ASSETS/name
                if not dst.exists():img.save(dst,quality=83,optimize=True,progressive=True)
                if dst.stat().st_size<8000:continue
                found.append({"file":name,"alt":f"{id}: {caption} (upstream app image)","origin":url})
                if len(found)>=need:break
            if len(found)>=need:break
        except Exception as e:
            warnings.append(f"{value[:60]}: {str(e)[:90]}")
    return id,found,None if len(found)>=need else f"Only {len(found)} of {need} needed real screenshots found; "+("; ".join(warnings[:2]))

def main():
    ASSETS.mkdir(parents=True,exist_ok=True)
    entries=get_sources()
    done={}
    issues={}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures={pool.submit(collect,item):item[0] for item in entries}
        for f in as_completed(futures):
            id,shots,error=f.result()
            done[id]=shots
            if error:issues[id]=error
            print(f"{'PASS' if not error else 'PARTIAL'} {id}: +{len(shots)} real upstream images"+(f" | {error[:135]}" if error else ""),flush=True)
    ordered={id:done.get(id,[]) for id,_repo in entries if done.get(id)}
    body="""/**
 * AUTO-GENERATED: extra genuine upstream application screenshots.
 * Existing original screenshots are preserved first and are not in this map.
 * These are upstream UI images, not proof that an app was built or launched.
 */
export const APP_SOURCE_SCREENSHOTS: Record<string, Array<{file:string;alt:string;origin:string}>> = """+json.dumps(ordered,ensure_ascii=False,indent=2)+";\n"
    OUTPUT.write_text(body,encoding="utf-8")
    REPORT.write_text(json.dumps({
        "totalApps":len(entries),"alreadyHas3":["astrofy"],
        "appsWithExtraImages":len(ordered),
        "totalNewImages":sum(len(v) for v in ordered.values()),
        "appsStillUnder3":[id for id,_repo in entries if EXISTING.get(id,0)+len(done.get(id,[]))<3],
        "issues":issues
    },indent=2)+"\n",encoding="utf-8")
    print(f"PASS: {sum(len(v) for v in ordered.values())} authentic extra images for {len(ordered)} apps; see coverage report for remaining gaps")

if __name__=="__main__":main()
