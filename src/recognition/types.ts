// Recognition contract from the v1 spec, section 8. The ML team ships the real SequenceRecognizer;
// the app ships the sign-window UI and state machine, the model loader, and the static/mock ones.

export interface ModelManifest {
  version: string;
  feature_version: string;
  runtime: string; // e.g. 'onnxruntime-web' or 'tfjs', chosen by the ML team
  input_frames: number;
  files: string[];
  classes: string[];
  threshold: number;
  sha256: string;
  /** Module inside `files` exporting createSequenceRecognizer(). App-side convention. */
  entry?: string;
}

export interface Alternative {
  label: string;
  confidence: number;
}

export interface RecognitionResult {
  /** 'none' means: not recognized */
  label: string;
  confidence: number;
  alternatives: Alternative[];
  reason?: string;
}

export type ProgressPhase = 'countdown' | 'recording' | 'processing';

export interface RecognitionProgress {
  phase: ProgressPhase;
  /** ms elapsed in this phase */
  ms: number;
  /** ms this phase lasts at most (for the progress ring) */
  totalMs?: number;
}

export type RecognizerEvent = 'progress' | 'result' | 'error';

export interface SequenceRecognizer {
  load(manifest: ModelManifest): Promise<void>;
  attach(video: HTMLVideoElement): void; // unmirrored video
  detach(): void;
  startWindow(): void; // user pressed Sign now
  cancelWindow(): void;
  /** Finish a complete sign before the maximum recording time. */
  finishWindow?(): void;
  on(event: 'progress', cb: (e: RecognitionProgress) => void): void;
  on(event: 'result', cb: (e: RecognitionResult) => void): void;
  on(event: 'error', cb: (e: { message: string }) => void): void;
}

/** Small typed event emitter shared by the app's recognizers. */
export class Emitter {
  private handlers: { [K in RecognizerEvent]: ((e: never) => void)[] } = { progress: [], result: [], error: [] };
  on(event: RecognizerEvent, cb: (e: never) => void): void {
    this.handlers[event].push(cb);
  }
  off(): void {
    this.handlers = { progress: [], result: [], error: [] };
  }
  emit(event: 'progress', e: RecognitionProgress): void;
  emit(event: 'result', e: RecognitionResult): void;
  emit(event: 'error', e: { message: string }): void;
  emit(event: RecognizerEvent, e: unknown): void {
    for (const h of this.handlers[event]) (h as (x: unknown) => void)(e);
  }
}
