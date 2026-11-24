import type { Lang, SttProvider } from '../types';
import { SpeechInputError } from './speechErrors';

export type LocalSttStatus = 'idle' | 'requesting-microphone' | 'recording' | 'processing' | 'error';

export interface LocalSttOptions {
  serviceKind?: 'local' | 'hosted';
  /** Base URL of the optional service running on this computer. */
  url?: string;
  onStatus?: (status: LocalSttStatus) => void;
  onError?: (error: Error) => void;
  fetcher?: typeof fetch;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  recorderClass?: typeof MediaRecorder;
  timeoutMs?: number;
  maxDurationMs?: number;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Captures a real microphone turn; stop() waits for its transcription. */
export class LocalWhisperStt implements SttProvider {
  private readonly options: LocalSttOptions;
  private generation = 0;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private chunks: Blob[] = [];
  private bytes = 0;
  private lang: Lang = 'uz';
  private onText?: (text: string, final: boolean) => void;
  private stopPromise?: Promise<void>;
  private requesting = false;
  private captureError?: Error;

  constructor(options: LocalSttOptions = {}) { this.options = options; }

  async start(lang: Lang, onText: (text: string, final: boolean) => void): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const devices = this.options.mediaDevices ?? globalThis.navigator?.mediaDevices;
    const Recorder = this.options.recorderClass ?? globalThis.MediaRecorder;
    if (!devices?.getUserMedia || !Recorder) {
      throw new Error('Microphone recording is unavailable. Open Lingora in Chrome or Edge over HTTPS or localhost.');
    }
    this.lang = lang;
    this.onText = onText;
    this.requesting = true;
    this.status('requesting-microphone');
    try {
      const stream = await devices.getUserMedia({ audio: true });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.requesting = false;
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(type => Recorder.isTypeSupported(type));
      const recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (generation !== this.generation || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > MAX_BYTES) {
          this.captureError = new Error('Recording is too large. Please speak for a shorter time.');
          void this.finishAutomatically();
          return;
        }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.captureError = new Error('Microphone recording failed. Please try again.');
        void this.finishAutomatically();
      };
      recorder.start(250);
      this.status('recording');
      // Leave room for the recorder's last encoded audio frame under the server's 30 s limit.
      this.timer = setTimeout(() => void this.finishAutomatically(), Math.min(this.options.maxDurationMs ?? 28_000, 28_000));
    } catch (error) {
      if (generation !== this.generation) return;
      this.requesting = false;
      this.releaseTracks();
      this.status('error');
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.requesting) {
      this.cancel();
      return Promise.resolve();
    }
    if (!this.recorder) return Promise.resolve();
    const generation = this.generation;
    const pending = this.finish(generation);
    this.stopPromise = pending;
    void pending.then(() => {
      if (generation === this.generation) this.stopPromise = undefined;
    }, () => {
      if (generation === this.generation) this.stopPromise = undefined;
    });
    return pending;
  }

  /** Discard a turn on navigation/reset; also cleans up a late microphone permission grant. */
  cancel(): void {
    this.generation++;
    this.requesting = false;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = undefined;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder?.state !== 'inactive' && recorder) recorder.stop();
    this.releaseTracks();
    this.chunks = [];
    this.bytes = 0;
    this.captureError = undefined;
    this.stopPromise = undefined;
    this.onText = undefined;
    this.status('idle');
  }

  private async finishAutomatically(): Promise<void> {
    try { await this.stop(); }
    catch (error) { this.options.onError?.(error instanceof Error ? error : new Error(String(error))); }
  }

  private async finish(generation: number): Promise<void> {
    clearTimeout(this.timer);
    const recorder = this.recorder!;
    try {
      if (recorder.state !== 'inactive') {
        await new Promise<void>(resolve => {
          recorder.onstop = () => resolve();
          recorder.stop();
          this.releaseTracks();
        });
      } else this.releaseTracks();
      if (generation !== this.generation) return;
      this.recorder = undefined;
      if (this.captureError) throw this.captureError;
      const blob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || 'audio/webm' });
      this.chunks = [];
      this.bytes = 0;
      if (!blob.size) throw new Error('No microphone audio was recorded. Please try again.');
      this.status('processing');
      const controller = new AbortController();
      this.controller = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.options.timeoutMs ?? 120_000);
      try {
        const base = (this.options.url ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
        const response = await (this.options.fetcher ?? fetch)(`${base}/api/transcribe?language=${this.lang}`, {
          method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: controller.signal,
        });
        if (generation !== this.generation) return;
        const data: unknown = await response.json();
        if (!response.ok) {
          if (data && typeof data === 'object' && 'code' in data && data.code === 'invalid_language') {
            throw new SpeechInputError('unsupported_language', 'The selected local model does not support this language.');
          }
          const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error : `Local speech service returned HTTP ${response.status}.`;
          throw new Error(message);
        }
        if (!data || typeof data !== 'object' || !('text' in data) || typeof data.text !== 'string' || data.text.length > 20_000) {
          throw new Error('Local speech service returned an invalid transcript.');
        }
        if (generation !== this.generation) return;
        this.onText?.(data.text.trim(), true);
        this.status('idle');
      } catch (error) {
        if (generation !== this.generation) return;
        if (timedOut) throw new SpeechInputError('timeout', 'Local speech recognition timed out. Check the speech server and try a shorter turn.');
        if (error instanceof TypeError) throw new SpeechInputError('service_unavailable', this.options.serviceKind === 'hosted'
          ? 'Cannot reach the configured speech server. It may be starting up or busy.'
          : 'Cannot reach the local speech service. Start the Python speech server on this computer.');
        throw error;
      } finally {
        clearTimeout(timeout);
        if (generation === this.generation) this.controller = undefined;
      }
    } catch (error) {
      if (generation === this.generation) this.status('error');
      throw error;
    } finally {
      if (generation === this.generation) this.releaseTracks();
    }
  }

  private releaseTracks(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
  }

  private status(status: LocalSttStatus): void { this.options.onStatus?.(status); }
}

export { LocalWhisperStt as LocalStt };
