"""Extract reviewed existing-video examples into local browser motion templates.

Requires opencv-python, mediapipe, numpy and the existing Hand/Pose task models.
This tool never downloads footage or infers sign labels. The reviewed JSON lists
complete sign repetitions and their visible caption evidence. Files stay private.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def extract(video: Path, review: Path, models: Path, legacy_tool: Path, out: Path,
            sample_fps: float, allow_local_unverified: bool):
    import cv2
    spec=importlib.util.spec_from_file_location("legacy_video_landmarks",legacy_tool)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    reviewed=json.loads(review.read_text(encoding="utf-8"))
    segments=reviewed["segments"]
    if not segments:raise ValueError("No reviewed sign repetitions")
    if reviewed.get("permission_status")!="confirmed" and not allow_local_unverified:
        raise ValueError("Source training permission unverified; local experiment requires --local-experiment-only")
    for s in segments:
        if not s.get("reviewed") or not s.get("label_evidence"):
            raise ValueError("Each segment must have reviewed caption or aligned audio evidence")
        if not 0<=s["start_s"]<s["end_s"] or not .25<=s["end_s"]-s["start_s"]<=20:
            raise ValueError("Each complete isolated phrase must last 0.25-20s")
    cap=cv2.VideoCapture(str(video))
    fps=cap.get(cv2.CAP_PROP_FPS)
    aspect=cap.get(cv2.CAP_PROP_FRAME_WIDTH)/cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    stride=max(1,round(fps/sample_fps))
    start_frame=max(0,int(min(s["start_s"] for s in segments)*fps)-stride)
    end_frame=int(max(s["end_s"] for s in segments)*fps)+stride
    detector=module.MediaPipeExtractor(str(models/"hand_landmarker.task"),str(models/"pose_landmarker_full.task"))
    cap.set(cv2.CAP_PROP_POS_FRAMES,start_frame)
    frames=[]
    for frame_index in range(start_frame,end_frame+1):
        ok,bgr=cap.read()
        if not ok:break
        if (frame_index-start_frame)%stride:continue
        if not any(s["start_s"]-.1<=frame_index/fps<=s["end_s"]+.1 for s in segments):continue
        det=detector.detect(cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB))
        f=module.frame_record(frame_index/fps*1000,det)
        frames.append(f)
    cap.release()
    for attr in ["hands","pose"]:
        getattr(detector,attr).close()
    out.mkdir(parents=True,exist_ok=True)
    (out/"reviewed-region.frames.json").write_text(json.dumps({"format":"lingora-frames-v1","video":video.name,"fps":fps/stride,"aspect":aspect,"mirror":False,"frames":frames}),encoding="utf-8")
    points=lambda arr:None if arr is None else [{"x":p[0],"y":p[1],"z":p[2]} for p in arr]
    source_hash=hashlib.sha256(video.read_bytes()).hexdigest()
    datasets={"train":[],"heldout":[],"negative":[]}
    stats=[]
    for s in segments:
        take=[f for f in frames if s["start_s"]*1000<=f["t"]<=s["end_s"]*1000]
        if reviewed.get("trim_empty_endpoints"):
            tracked=[i for i,f in enumerate(take) if f["L"] or f["R"]]
            if tracked:take=take[tracked[0]:tracked[-1]+1]
        if len(take)<5:raise ValueError(f"Too few frames for {s['id']}")
        coverage=sum(bool(f["L"]) or bool(f["R"]) for f in take)/len(take)
        role=s.get("role","train")
        if role not in datasets:raise ValueError(f"Unknown role {role}")
        source={"kind":reviewed.get("source_kind","lesson"),"name":video.name,"permission":reviewed.get("permission_evidence") or "Training reuse not independently verified; local experiment only"}
        datasets[role].append({"id":s["id"],"label":"expected_none" if role=="negative" else s["label"],"frames":[{"t":f["t"],"left":points(f["L"]),"right":points(f["R"]),"pose":points(f["pose"]),"aspect":round(aspect,5)} for f in take],"source":source})
        stats.append({**s,"frames":len(take),"hand_coverage":round(coverage,3),"both_hands_coverage":round(sum(bool(f["L"]) and bool(f["R"]) for f in take)/len(take),3),"pose_coverage":round(sum(bool(f["pose"]) for f in take)/len(take),3),"source_sha256":source_hash})
    for role,templates in datasets.items():
        if templates:
            (out/f"templates-{role}.json").write_text(json.dumps({"format":"lingora-motion-templates","version":1,"templates":templates},separators=(",",":")),encoding="utf-8")
    (out/"extraction-report.json").write_text(json.dumps({"source":str(video.resolve()),"source_sha256":source_hash,"permission_status":reviewed.get("permission_status","unresolved"),"local_experiment_only":reviewed.get("permission_status")!="confirmed","sample_fps":fps/stride,"clips":stats},ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"counts":{k:len(v) for k,v in datasets.items()},"out":str(out),"clips":stats},ensure_ascii=True))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--video",type=Path,required=True)
    p.add_argument("--review",type=Path,required=True)
    p.add_argument("--models",type=Path,required=True)
    p.add_argument("--legacy-tool",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    p.add_argument("--fps",type=float,default=12.5)
    p.add_argument("--local-experiment-only",action="store_true")
    a=p.parse_args()
    if not .5<=a.fps<=30:raise ValueError("FPS must be between0.5and30")
    extract(a.video,a.review,a.models,a.legacy_tool,a.out,a.fps,a.local_experiment_only)


if __name__=="__main__":main()
