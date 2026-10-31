"""Optional local geometry / foreground runtime. No package is loaded during editor startup.
Usage: python3 tools/setup-shorts-spatial.py [--advanced] [--home /path/to/runtime]
"""
from pathlib import Path
import argparse,hashlib,json,os,platform,subprocess,sys,urllib.request,shutil
p=argparse.ArgumentParser();p.add_argument('--advanced',action='store_true');p.add_argument('--matching',action='store_true');p.add_argument('--home',type=Path,default=Path(__file__).resolve().parents[1]);args=p.parse_args()
if sys.version_info<(3,10):raise SystemExit('Use Python 3.10 or newer (3.12 recommended).')
root=args.home.resolve();environment=root/'.venv-spatial';cache=root/'.cache/clyra-spatial';cache.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'-m','venv',str(environment)],check=True)
python=environment/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
def run(*cmd,**kw):subprocess.run([str(x) for x in cmd],check=True,**kw)
def pip(*packages):run(python,'-m','pip','install','--disable-pip-version-check',*packages)
pip('setuptools','pycolmap==3.11.1','opencv-python-headless==4.10.0.84','numpy==1.26.4','scipy==1.16.3','av==16.0.1','psutil==7.1.0')
previous=json.loads((cache/'installed.json').read_text()) if (cache/'installed.json').exists() else {}
manifest={**previous,'native':True,'advanced':previous.get('advanced',False),'platform':platform.platform(),'versions':{**previous.get('versions',{}),'pycolmap':'3.11.1','opencv':'4.10.0.84','numpy':'1.26.4','av':'16.0.1','solver':'spatial-v7'}}
if args.advanced:
    # Intel macOS has no current PyTorch wheels. This supported CPU fallback is tested separately.
    intel_mac=sys.platform=='darwin' and platform.machine()=='x86_64'
    pip(*(['torch==2.2.2','torchvision==0.17.2'] if intel_mac else ['torch==2.5.1','torchvision==0.20.1']))
    pip('hydra-core==1.3.2','iopath==0.1.10','pillow','matplotlib','tqdm','easydict','einops')
    sources=cache/'sources';sources.mkdir(exist_ok=True)
    for name,url,revision in [('sam2','https://github.com/facebookresearch/sam2.git','2b90b9f5ceec907a1c18123530e92e794ad901a4'),('video-depth-anything','https://github.com/DepthAnything/Video-Depth-Anything.git','4f5ae23172ba60fd7bc11ef671cca678842c7072')]:
        directory=sources/name
        if not directory.exists():run('git','clone','--filter=blob:none',url,directory)
        # Checkout only this installer-owned cache; a modified existing checkout is refused.
        if subprocess.check_output(['git','status','--porcelain'],cwd=directory,text=True).strip():raise SystemExit(f'{directory} has local changes; use a clean runtime directory.')
        run('git','checkout','--detach',revision,cwd=directory);manifest['versions'][name]=revision
    os.environ['SAM2_BUILD_CUDA']='0' if sys.platform=='darwin' else os.environ.get('SAM2_BUILD_CUDA','1')
    pip('--no-deps','--no-build-isolation',str(sources/'sam2'))
    models=cache/'models';models.mkdir(exist_ok=True)
    for name,url,expected in [('sam2.1_hiera_tiny.pt','https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt','7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69'),('video_depth_anything_vits.pth','https://huggingface.co/depth-anything/Video-Depth-Anything-Small/resolve/main/video_depth_anything_vits.pth?download=true','13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609')]:
        target=models/name
        if not target.exists():
            part=target.with_suffix('.download');urllib.request.urlretrieve(url,part);part.replace(target)
        h=hashlib.sha256()
        with target.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
        if h.hexdigest()!=expected:raise SystemExit(f'Checksum mismatch for {name}. Installation not activated.')
        manifest['versions'][name]=expected
    manifest['advanced']=True
if args.matching:
    intel_mac=sys.platform=='darwin' and platform.machine()=='x86_64'
    pip(*(['torch==2.2.2','torchvision==0.17.2'] if intel_mac else ['torch==2.5.1','torchvision==0.20.1']))
    # No duplicate opencv-python package; the native path already supplies cv2.
    pip('--no-deps','kornia==0.7.3','kornia-rs==0.1.9')
    directory=cache/'sources/lightglue-upstream';revision='5a650c444718caffc2669dc0094cde908f42dd73'
    if not directory.exists():run('git','clone','--filter=blob:none','https://github.com/cvg/LightGlue.git',directory)
    if subprocess.check_output(['git','status','--porcelain'],cwd=directory,text=True).strip():raise SystemExit('The installer-owned LightGlue checkout has local changes.')
    run('git','checkout','--detach',revision,cwd=directory)
    runtime=cache/'sources/lightglue-runtime';package=runtime/'lightglue';package.mkdir(parents=True,exist_ok=True)
    for file in ['aliked.py','lightglue.py','utils.py']:shutil.copy2(directory/'lightglue'/file,package/file)
    (package/'__init__.py').write_text('from .aliked import ALIKED\nfrom .lightglue import LightGlue\n')
    shutil.copy2(directory/'LICENSE',runtime/'LICENSE-LightGlue')
    (runtime/'NOTICE').write_text('LightGlue '+revision+'. Only ALIKED, matcher and utilities are provisioned. SuperPoint and its restrictive implementation/weights are excluded. __init__ modified to import only the permitted subset. ALIKED BSD-3-Clause notice remains in aliked.py.\n')
    models=cache/'torch/hub/checkpoints';models.mkdir(parents=True,exist_ok=True)
    for name,url,expected in [('aliked-n16.pth','https://github.com/Shiaoming/ALIKED/raw/main/models/aliked-n16.pth','5be8704840ed662d9d8c561bf7279c222092674e7eb05fd0feab94899e9d82f2'),('aliked_lightglue_v0-1_arxiv.pth','https://github.com/cvg/LightGlue/releases/download/v0.1_arxiv/aliked_lightglue.pth','d975e965b105311a6143194852297dff4f02aea5cc2e10cecfed966ca0e22503')]:
        target=models/name
        if not target.exists():urllib.request.urlretrieve(url,target)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=expected:raise SystemExit('Checksum mismatch for '+name)
        manifest['versions'][name]=expected
    manifest['matching']=True;manifest['versions']['lightglue']=revision
# Confirm imports using the target environment, not the installer Python.
run(python,'-c','import av,cv2,pycolmap,numpy'+(';import torch,sam2' if args.advanced else ''))
(cache/'installed.json').write_text(json.dumps(manifest,indent=2))
print('Spatial runtime installed. Set CLYRA_SPATIAL_HOME to this directory when it is outside the Clyra workspace.')
