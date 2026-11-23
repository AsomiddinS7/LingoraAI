import { basename } from 'node:path';

/** Treat per-clip filename annotations as one recording, not independent sources. */
export function recordingName(name) {
  return basename(name.replaceAll('\\', '/').replace(/\s*\[\d+(?:\.\d+)?-\d+(?:\.\d+)?s\]$/, ''));
}
