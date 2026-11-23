"""Inspect existing videos and export reviewed landmark segments; never infer labels."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
from pathlib import Path


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def inventory(source, out, interval):
    import cv2
    import numpy as np
    sources = []
    for index, video in enumerate(sorted(source.glob("*.mp4")), 1):
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS)
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0 or count <= 0:
            raise ValueError(f"Cannot read video: {video.name}")
        duration = count / fps
        source_id = f"source_{index:02d}"
        width, height = int(cap.get(3)), int(cap.get(4))
        cache = source / "work" / video.stem / f"{video.stem}.frames.json"
        cache_duration = None
        if cache.exists():
            cached = json.loads(cache.read_text(encoding="utf-8"))
            frames = cached.get("frames", [])
            cache_duration = frames[-1]["t"] / 1000 if frames else 0
        times = list(range(0, math.ceil(duration), max(1, round(interval))))
        tile_w, tile_h, cols = 320, 204, 5
        rows = math.ceil(len(times) / cols)
        sheet = np.full((rows * tile_h, cols * tile_w, 3), 245, dtype=np.uint8)
        for k, second in enumerate(times):
            cap.set(cv2.CAP_PROP_POS_MSEC, second * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            thumbnail = cv2.resize(frame, (tile_w, 180))
            y, x = (k // cols) * tile_h, (k % cols) * tile_w
            sheet[y:y+180, x:x+tile_w] = thumbnail
            cv2.putText(sheet, f"{source_id} {second//60:02d}:{second%60:02d}",
                        (x+6, y+197), cv2.FONT_HERSHEY_SIMPLEX, .48, (20,20,20), 1)
        cap.release()
        contact_path = out / "contacts" / f"{source_id}.jpg"
        contact_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(contact_path), sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
        sources.append({"id": source_id, "video": str(video.resolve()),
            "sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
            "duration_s": round(duration,3), "fps": fps, "width": width,"height": height,
            "cached_landmarks": str(cache.resolve()) if cache.exists() else None,
            "cached_duration_s": cache_duration, "contacts": str(contact_path.resolve()),
            "source_type": "unreviewed", "permission_status": "unresolved",
            "permission_evidence": "", "signer_id": "unassigned"})
    write_json(out / "sources.json", {"format":"lingora-video-sources-v1","sources":sources})
    review_path = out / "review.json"
    if not review_path.exists():
        write_json(review_path, {"format":"lingora-video-review-v1","segments":[],
            "instructions":"Add source_id/start_s/end_s/sign/label_uz/label_evidence/reviewed. Confirm source permission separately in sources.json. No automatically inferred labels."})
    print(json.dumps({"sources":len(sources),"manifest":str(out / "sources.json")},ensure_ascii=True))


def export(sources_path, review_path, output):
    sources = {s["id"]:s for s in json.loads(sources_path.read_text(encoding="utf-8"))["sources"]}
    clips = []
    for index, segment in enumerate(json.loads(review_path.read_text(encoding="utf-8"))["segments"]):
        source = sources[segment["source_id"]]
        if not segment.get("reviewed") or not segment.get("label_evidence"):
            raise ValueError(f"Segment {index} has no reviewed label evidence")
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}",segment.get("sign","")):
            raise ValueError(f"Segment {index} needs a valid sign id")
        if source.get("permission_status") != "confirmed" or not source.get("permission_evidence"):
            raise ValueError(f"Source {source['id']} has no confirmed reuse permission")
        cache_path = source.get("cached_landmarks")
        if not cache_path:
            raise ValueError(f"Source {source['id']} has no landmark cache")
        cache = json.loads(Path(cache_path).read_text(encoding="utf-8"))
        start,end = float(segment["start_s"]),float(segment["end_s"])
        if not 0 <= start < end <= source["duration_s"] or not .25 <= end-start <= 8:
            raise ValueError(f"Segment {index} must be an isolated 0.25-8s sign within its source")
        frames = [f for f in cache["frames"] if start*1000 <= f["t"] <= end*1000]
        if len(frames) < 5 or cache["frames"][-1]["t"] < end*1000-100:
            raise ValueError(f"Segment {index} is not covered by cached landmarks; re-extract this time range")
        if sum(bool(f.get("L")) or bool(f.get("R")) for f in frames)/len(frames) < .6:
            raise ValueError(f"Segment {index} has inadequate hand tracking")
        normalized = [{**f,"t":round(f["t"]-start*1000)} for f in frames]
        clips.append({"id":segment.get("id",f"{source['id']}_{index:03d}"),
            "sign":segment["sign"],"label_uz":segment.get("label_uz",""),
            "signer_id":source["signer_id"],"source_id":source["id"],
            "source_video":Path(source["video"]).name,"source_sha256":source["sha256"],
            "t0_s":start,"t1_s":end,"fps":cache["fps"],"aspect":cache["aspect"],
            "n_frames":len(normalized),"frames":normalized,
            "label_evidence":segment["label_evidence"],"permission":source["permission_evidence"],
            "consent":True,"role":segment.get("role","train")})
    if not clips:
        raise ValueError("No reviewed segments; refusing to export an empty or fabricated dataset")
    write_json(output,{"format":"lingora-sequences-v1","source":"existing_video","clips":clips})
    print(json.dumps({"clips":len(clips),"output":str(output)}))


def contacts(video, output, start, end, step):
    import cv2
    import numpy as np
    if not 0 <= start < end or step <= 0:
        raise ValueError("Invalid contact-sheet time range")
    times = [start+i*step for i in range(math.ceil((end-start)/step))]
    tile_w,tile_h,cols=384,240,5
    sheet=np.full((math.ceil(len(times)/cols)*tile_h,cols*tile_w,3),245,dtype=np.uint8)
    cap=cv2.VideoCapture(str(video))
    for k,t in enumerate(times):
        cap.set(cv2.CAP_PROP_POS_MSEC,t*1000)
        ok,frame=cap.read()
        if not ok:continue
        y,x=(k//cols)*tile_h,(k%cols)*tile_w
        sheet[y:y+216,x:x+tile_w]=cv2.resize(frame,(tile_w,216))
        cv2.putText(sheet,f"{t:.2f}s ({int(t)//60:02d}:{t%60:04.1f})",(x+6,y+234),cv2.FONT_HERSHEY_SIMPLEX,.5,(20,20,20),1)
    cap.release()
    output.parent.mkdir(parents=True,exist_ok=True)
    cv2.imwrite(str(output),sheet,[cv2.IMWRITE_JPEG_QUALITY,90])
    print(str(output))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest="command",required=True)
    inv=sub.add_parser("inventory")
    inv.add_argument("--source",type=Path,required=True)
    inv.add_argument("--out",type=Path,required=True)
    inv.add_argument("--interval",type=float,default=30)
    build=sub.add_parser("export")
    build.add_argument("--sources",type=Path,required=True)
    build.add_argument("--review",type=Path,required=True)
    build.add_argument("--out",type=Path,required=True)
    contact=sub.add_parser("contacts")
    contact.add_argument("--video",type=Path,required=True)
    contact.add_argument("--out",type=Path,required=True)
    contact.add_argument("--start",type=float,required=True)
    contact.add_argument("--end",type=float,required=True)
    contact.add_argument("--step",type=float,default=1)
    args=p.parse_args()
    if args.command=="inventory":inventory(args.source,args.out,args.interval)
    elif args.command=="export":export(args.sources,args.review,args.out)
    else:contacts(args.video,args.out,args.start,args.end,args.step)


if __name__=="__main__":main()
