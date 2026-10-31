"""Small deterministic native regressions; no model or network downloads."""
from pathlib import Path
import sys,tempfile,json,hashlib,unittest
import numpy as np,cv2
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'apps/shorts/openfilm/packages/openfilm/studio/server/spatial'))
from mask_corrections import correct
class Corrections(unittest.TestCase):
 def test_instance_and_exact_source_interval(self):
  with tempfile.TemporaryDirectory(prefix='clyra-mask-regression-') as tmp:
   root=Path(tmp);base=root/'base';base.mkdir();out=root/'corrected';out.mkdir();rows=[]
   for t in [0,41667,83333]:
    entries=[];union=np.zeros((40,80),np.uint8)
    for identifier,x in [(1,10),(2,55)]:
     mask=np.zeros_like(union);mask[10:30,x:x+10]=255;name=f'{t}-{identifier}.png';cv2.imwrite(str(base/name),mask);entries.append({'id':identifier,'path':name});union=np.maximum(union,mask)
    cv2.imwrite(str(base/f'{t}-union.png'),union);rows.append({'sourceTimeUs':t,'mask':f'{t}-union.png','instances':entries})
   metadata=base/'occlusion.json';metadata.write_text(json.dumps({'width':80,'height':40,'frames':rows}));before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in base.iterdir()}
   data=correct({'baseOcclusion':str(metadata),'output':str(out),'corrections':[{'x':.21,'y':.5,'r':.08,'add':False,'from':.041667,'to':.041667,'instanceId':1}]})
   self.assertEqual(data['manualCorrections']['affectedFrames'],1);self.assertFalse(data['frames'][0].get('manuallyCorrected',False));self.assertTrue(data['frames'][1]['manuallyCorrected']);self.assertEqual(before,{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in base.iterdir()})
   original=cv2.imread(str(base/'41667-2.png'),0);edited=cv2.imread(str(out/data['frames'][1]['instances'][1]['path']),0);np.testing.assert_array_equal(original,edited)
   missing=correct({'baseOcclusion':str(metadata),'output':str(root/'missing'),'corrections':[{'x':.21,'y':.5,'r':.08,'add':False,'from':0,'to':1,'instanceId':99}]});self.assertEqual(missing['manualCorrections']['affectedFrames'],0)
if __name__=='__main__':unittest.main()
