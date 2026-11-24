"""Prepare reviewed, disjoint first/second repetitions without changing labels."""
import hashlib,json,math
from pathlib import Path
import cv2
import numpy as np

ROOT=Path('private-video-work/dataset-v3')
# Visually reviewed .4-second contact sheets. First/second movements remain
# disjoint same-session development repetitions, never independent signers.
WINDOWS={
 '1715-bermoq':[(.25,1.65),(2.35,3.8)],
 '1716-bilmoq':[(.10,1.35),(2.20,3.45)],
 '1721-chaqirmoq':[(.10,1.70),(2.20,3.85)],
 '1742-javob-bermoq':[(.10,1.45),(2.10,3.45)],
 '1778-qongiroq-qilmoq':[(.40,2.05),(2.85,4.50)],
 '1819-tushuntirmoq':[(.40,2.65),(3.35,5.60)],
 '385-bemor':[(.10,1.75),(2.15,3.80)],
 '805-manzil-805':[(1.00,2.70),(3.85,5.55)],
}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 sources=json.loads((ROOT/'sources.json').read_text(encoding='utf-8'))['entries'];out=ROOT/'simulation';out.mkdir(exist_ok=True)
 cases=[];review=[]
 for s in sources:
  slug=s['id'][5:];source=Path(s['crop_path']);assert sha(source)==s['crop_sha256']
  cap=cv2.VideoCapture(str(source));fps=cap.get(cv2.CAP_PROP_FPS);frames=[]
  while True:
   ok,f=cap.read()
   if not ok:break
   frames.append(f)
  cap.release()
  windows=WINDOWS[slug];assert windows[0][1]<windows[1][0]<windows[1][1]<s['duration_seconds']
  for take,(start,end) in enumerate(windows,1):
   role='train' if take==1 else 'regression';sample=f"{s['id']}-take-{take}"
   review.append({'id':sample,'label':s['label'],'labelUz':s['labelUz'],'source_url':s['source_url'],
                  'source_sha256':s['source_sha256'],'recordingId':s['id'],'sessionId':'uzsl-dictionary-session-unverified',
                  'source_start_s':start,'source_end_s':end,'role':role,'evidence':'Visible Uzbek frame caption matches exact source heading; movements and neutral separation reviewed.',
                  'specialist_semantic_review':'pending','independent_test':False})
   for scenario in ['nominal','dim_blur_reframe_fast']:
    adverse=scenario!='nominal';speed=1.25 if adverse else 1.;duration=(end-start)/speed+.4
    name=f'{sample}-{scenario}.mp4';path=out/name
    writer=cv2.VideoWriter(str(path),cv2.CAP_MSMF,cv2.VideoWriter_fourcc(*'H264'),25,(640,480));assert writer.isOpened()
    for i in range(math.ceil(duration*25)):
     t=min(end,max(start,start+(i/25-.2)*speed));frame=frames[min(len(frames)-1,round(t*fps))]
     h,w=frame.shape[:2];factor=min(640/w,480/h)*(.9 if adverse else 1);dw,dh=int(w*factor),int(h*factor)
     image=cv2.resize(frame,(dw,dh),interpolation=cv2.INTER_AREA);canvas=np.full((480,640,3),45,np.uint8)
     x=(640-dw)//2+(22 if adverse else 0);y=(480-dh)//2;canvas[y:y+dh,x:x+dw]=image
     if adverse:
      canvas=cv2.resize(cv2.resize(canvas,(320,240)),(640,480));canvas=cv2.GaussianBlur(canvas,(5,5),1.)
      canvas=np.clip(canvas.astype(np.float32)*.65,0,255).astype(np.uint8)
     writer.write(canvas)
    writer.release()
    cases.append({'id':path.stem,'sampleId':sample,'expected':s['label'],'labelUz':s['labelUz'],'scope':'word',
                  'split':role,'scenario':scenario,'file':name,'sourceRecordingId':s['id'],
                  'originalSha256':s['source_sha256'],'decodedSourceSha256':s['crop_sha256'],
                  'sourceWindowSeconds':[start,end],'sha256':sha(path),'durationSeconds':math.ceil(duration*25)/25,
                  'speed':speed,'paddingSeconds':.2,'resolution':[640,480],'fps':25,
                  'independentTest':False,'trainingSourceReplay':role=='train'})
 (ROOT/'reviewed-windows.json').write_text(json.dumps({'examples':review,'source_policy':'Existing public dictionary; private research, specialist validation and reuse permission pending.'},ensure_ascii=False,indent=2),encoding='utf-8')
 manifest={'format':'lingora-pixel-simulation-v1','cases':cases,'scenarios':{'nominal':'Unmodified signing in a640x480 letterbox','dim_blur_reframe_fast':'Dim, blur, reframe and1.25x speed'},
           'limitations':'Second takes are reserved, correlated same-session development examples. New signers untested. Source files remain private.',
           'counts':{'cases':len(cases),'wordLabels':8,'phraseLabels':0}}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(manifest['counts']))
if __name__=='__main__':main()
