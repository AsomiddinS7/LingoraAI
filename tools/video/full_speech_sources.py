"""Inspect an existing signed-speech candidate without inferring any sign meaning.

Produces local metadata and contact sheets only. Source review/label alignment is
separate; a video of a person signing does not establish a transcript by itself.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import wave
from pathlib import Path


def media_handlers(path: Path):
    handlers = []
    with path.open('rb') as f:
        def walk(start, end):
            pos = start
            while pos + 8 <= end:
                f.seek(pos)
                head = f.read(8)
                size, kind = struct.unpack('>I4s', head)
                header = 8
                if size == 1:
                    size = struct.unpack('>Q', f.read(8))[0]
                    header = 16
                elif size == 0:
                    size = end - pos
                if size < header or pos + size > end:
                    return
                if kind in (b'moov', b'trak', b'mdia'):
                    walk(pos + header, pos + size)
                elif kind == b'hdlr':
                    f.seek(pos + header + 8)
                    handlers.append(f.read(4).decode('ascii', errors='replace'))
                pos += size
        walk(0, path.stat().st_size)
    return handlers


def inspect(video: Path, output: Path, samples: int = 20, times: list[float] | None = None):
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise ValueError('Video cannot be decoded')
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = frames / fps if fps > 0 else None
    if not duration:
        raise ValueError('Video has no usable duration')
    output.mkdir(parents=True, exist_ok=True)
    cols, tile_w, tile_h = 5, 320, 320
    times = times or [min(duration - 1 / fps, i * duration / samples) for i in range(samples)]
    if any(not math.isfinite(t) or t < 0 or t >= duration for t in times):
        raise ValueError('Contact times must be within the video')
    sheet = np.full((math.ceil(len(times) / cols) * tile_h, cols * tile_w, 3), 238, dtype=np.uint8)
    for i, t in enumerate(times):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        scale = min(tile_w / frame.shape[1], (tile_h - 28) / frame.shape[0])
        small = cv2.resize(frame, (round(frame.shape[1] * scale), round(frame.shape[0] * scale)))
        x, y = (i % cols) * tile_w, (i // cols) * tile_h
        left = x + (tile_w - small.shape[1]) // 2
        sheet[y:y + small.shape[0], left:left + small.shape[1]] = small
        cv2.putText(sheet, f'{t:.2f}s', (x + 8, y + tile_h - 8), cv2.FONT_HERSHEY_SIMPLEX, .55, (20, 20, 20), 1)
    cap.release()
    contact = output / 'candidate-contact.jpg'
    cv2.imwrite(str(contact), sheet, [cv2.IMWRITE_JPEG_QUALITY, 92])
    handlers = media_handlers(video)
    metadata = {
        'source': str(video.resolve()), 'sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
        'bytes': video.stat().st_size, 'duration_s': round(duration, 3), 'fps': fps,
        'frames': frames, 'width': width, 'height': height,
        'container_handlers': handlers, 'has_audio_track': 'soun' in handlers,
        'contact_sheet': str(contact.resolve()), 'contact_times_s': times,
        'transcript_status': 'unverified', 'sentence_intervals': [],
        'note': 'Contact-sheet review cannot establish the meaning of uncaptioned signing. No training labels inferred.',
    }
    (output / 'candidate-metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps(metadata))


def extract_audio(video: Path, output: Path):
    """Decode privately to 16 kHz mono PCM for local speech verification."""
    import av
    import numpy as np

    output.mkdir(parents=True, exist_ok=True)
    destination = output / 'candidate.wav'
    resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
    chunks = []
    with av.open(str(video)) as container:
        if not container.streams.audio:
            raise ValueError('The candidate has no audio stream')
        stream = container.streams.audio[0]
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1).copy())
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1).copy())
    if not chunks:
        raise ValueError('The audio stream decoded no samples')
    pcm = np.concatenate(chunks).astype('<i2')
    with wave.open(str(destination), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm.tobytes())
    normalized = pcm.astype(np.float64) / 32768
    rms = float(np.sqrt(np.mean(normalized ** 2)))
    metadata = {
        'source': str(video.resolve()), 'wav': str(destination.resolve()),
        'sample_rate': 16000, 'channels': 1, 'samples': len(pcm),
        'duration_s': round(len(pcm) / 16000, 3),
        'rms': rms, 'rms_dbfs': 20 * math.log10(rms) if rms else None,
        'peak': float(np.max(np.abs(normalized))),
        'audio_content_reviewed': False,
        'note': 'Signal level does not establish spoken words; local transcription or listening is still required.',
    }
    (output / 'candidate-audio.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps(metadata))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=20)
    parser.add_argument('--audio-only', action='store_true', help='Extract private 16 kHz mono audio with PyAV; skip video contact sheet')
    parser.add_argument('--times', help='Optional comma-separated seconds for close visual review')
    args = parser.parse_args()
    if not 5 <= args.samples <= 100:
        raise ValueError('Choose 5-100 samples')
    if args.audio_only:
        extract_audio(args.video, args.out)
    else:
        inspect(args.video, args.out, args.samples, [float(t) for t in args.times.split(',')] if args.times else None)
