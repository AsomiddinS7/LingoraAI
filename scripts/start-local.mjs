import { createSpeechServer } from './speech-server.mjs';

const port = Number(process.env.SPEECH_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port');
process.env.SPEECH_SERVE_DIST ??= 'true';
process.env.SPEECH_PUBLIC_ORIGIN ??= `http://localhost:${port}`;
createSpeechServer().listen(port, '127.0.0.1', () => {
  console.log(`Open http://localhost:${port}/#/conversation`);
});
