"""Bounded collection of eight additional dictionary words for private review."""
import hashlib
from html import unescape
import json
from pathlib import Path
import re
import time
import urllib.request
from urllib.parse import urljoin
import cv2
from PIL import Image, ImageDraw

ROOT = Path('private-video-work/dataset-v3')
WORDS = [('20-tez-tez-islatiladigan-sozlar','1715-bermoq','Bermoq'),
         ('20-tez-tez-islatiladigan-sozlar','1716-bilmoq','Bilmoq'),
         ('20-tez-tez-islatiladigan-sozlar','1721-chaqirmoq','Chaqirmoq'),
         ('20-tez-tez-islatiladigan-sozlar','1742-javob-bermoq','Javob bermoq'),
         ('20-tez-tez-islatiladigan-sozlar','1778-qongiroq-qilmoq',"Qo‘ng‘iroq qilmoq"),
         ('20-tez-tez-islatiladigan-sozlar','1819-tushuntirmoq','Tushuntirmoq'),
         ('9-sifoxona','385-bemor','Bemor'),('11-mahalla','805-manzil-805','Manzil')]
def sha(data): return hashlib.sha256(data).hexdigest()
def fetch(url, limit):
    request = urllib.request.Request(url, headers={'User-Agent':'LingoraAI bounded private dictionary research'})
    with urllib.request.urlopen(request, timeout=45) as r:
        data = r.read(limit+1)
    if len(data)>limit: raise ValueError('Download limit exceeded')
    return data

def main():
    for folder in ['pages','media','crops','review']: (ROOT/folder).mkdir(parents=True,exist_ok=True)
    entries=[]; total=0
    for category, slug, gloss in WORDS:
        url=f'https://imo-ishora.uz/dictionary/{category}/{slug}'
        page_path=ROOT/'pages'/(slug+'.html')
        payload=page_path.read_bytes() if page_path.exists() else fetch(url,500_000)
        page_path.write_bytes(payload); page=payload.decode('utf-8')
        headings=[unescape(re.sub('<[^>]+>','',t)).strip() for t in re.findall(r'<h2[^>]*>(.*?)</h2>',page,re.S)]
        if gloss not in headings: raise ValueError(f'Unexpected source caption for {slug}: {headings}')
        match=re.search(r'<video\b[^>]*\bsrc="([^"]+)"',page)
        if not match: raise ValueError('Missing video source')
        media_url=urljoin(url,unescape(match.group(1)))
        source=ROOT/'media'/(slug+'.mp4')
        video=source.read_bytes() if source.exists() else fetch(media_url,12_000_000)
        source.write_bytes(video); total+=len(video)
        if total>80_000_000: raise ValueError('Collection total exceeds80MB')
        cap=cv2.VideoCapture(str(source));fps=cap.get(cv2.CAP_PROP_FPS)
        w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT));n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not fps or not 1<=n/fps<=16: raise ValueError('Invalid source duration')
        crop=ROOT/'crops'/(slug+'.mp4');cw=int(w*.55)//2*2
        writer=cv2.VideoWriter(str(crop),cv2.CAP_MSMF,cv2.VideoWriter_fourcc(*'H264'),fps,(cw,h))
        if not writer.isOpened(): raise RuntimeError('Missing Windows H264 encoder')
        samples=[];i=0
        while True:
            ok,frame=cap.read()
            if not ok:break
            writer.write(frame[:,:cw])
            if i%max(1,round(fps*.4))==0:samples.append((i/fps,frame))
            i+=1
        writer.release();cap.release()
        cols=5;tw=240;th=160
        sheet=Image.new('RGB',(cols*tw,((len(samples)+cols-1)//cols)*th+30),'white');draw=ImageDraw.Draw(sheet)
        draw.text((5,5),slug+' | '+gloss,fill='black')
        for j,(t,frame) in enumerate(samples):
            image=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));image.thumbnail((tw,th-20))
            x=(j%cols)*tw;y=(j//cols)*th+30;sheet.paste(image,(x,y));draw.text((x+5,y+th-19),f'{t:.2f}s',fill='black')
        sheet.save(ROOT/'review'/(slug+'.jpg'))
        entries.append({'id':'uzsl-'+slug,'label':'uzsl_'+slug.replace('-','_'),'labelUz':gloss,'source_url':url,
                        'media_url':media_url,'source_html_sha256':sha(payload),'source_sha256':sha(video),
                        'source_path':str(source).replace('\\','/'),'crop_path':str(crop).replace('\\','/'),
                        'crop_sha256':sha(crop.read_bytes()),'crop_xywh':[0,0,cw,h],'duration_seconds':n/fps,'fps':fps,
                        'headings':headings,'label_evidence':'Exact source page heading; frame-caption/movement review pending',
                        'semantic_specialist_review':'pending','reuse_status':'unverified; private research only',
                        'role':'quarantine_pending_boundary_review','independent_signer_count':'unknown'})
        (ROOT/'sources.json').write_text(json.dumps({'format':'lingora-dictionary-review-v1','entries':entries},ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'downloaded':slug,'seconds':n/fps,'bytes':len(video)}),flush=True);time.sleep(.5)

if __name__=='__main__':main()
