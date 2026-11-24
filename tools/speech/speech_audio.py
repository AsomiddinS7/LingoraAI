"""Deterministic bounded audio preprocessing; no transcript or reference access."""
def level_audio(audio):
    import numpy as np
    values = np.asarray(audio, dtype=np.float32)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError('Expected finite mono audio')
    if not values.size:
        return values.copy()
    centered = values - values.mean()
    rms = float(np.sqrt(np.mean(centered ** 2)))
    if rms < 1e-6:
        return centered
    # Raise quiet speech, at most8x, and avoid amplifying beyond the peak limit.
    gain = min(8., max(1., .06 / rms), .98 / max(float(np.max(np.abs(centered))), 1e-8))
    return (centered * gain).astype(np.float32)
