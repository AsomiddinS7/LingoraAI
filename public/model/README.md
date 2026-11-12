# /model (owned by the team)

Put the classifier here. The app loads it only when `VITE_SIGN_CLASSIFIER=model`
(or `signClassifier = model` in the Console).

Loader hook contract: `public/model/classifier.js` is an ES module that exports

```js
export function createClassifier({ startFramePump }) {
  let stop = null;
  return {
    async load() { /* fetch model files from ./model/, warm up once with a dummy frame */ },
    attach(video, onSign) {
      // One call per NEW camera frame; frames are skipped (not queued) while the previous
      // one is still being processed, so latency never builds up. maxFps is optional.
      stop = startFramePump(video, async (video, frameTime) => {
        // landmarks = handLandmarker.detectForVideo(video, frameTime)  (MediaPipe, GPU delegate)
        // run the classifier on the landmarks, apply the stability filter,
        // then call onSign({ label, confidence }) ONCE per stable sign.
      }, { maxFps: 30 });
    },
    detach() { stop?.(); stop = null; },
  };
}
```

`label` must be a label from `src/data/vocabulary.json` or `'none'`. Video frames must stay on the device.

Using `startFramePump` makes the Console's "Recognition performance" panel show real
frames analysed per second, time per frame and skipped frames. The app also ignores repeats
of a held sign (gesture gate) and measures detection-to-screen latency.

Speed tips: use MediaPipe Hand Landmarker in `VIDEO` running mode with the GPU delegate,
classify on the 21 landmarks (not pixels), keep the input at 640x480, and run the classifier
in a Web Worker if it takes more than a few ms per frame.

If this file is missing or `load()` throws, the app shows "Sign recognition did not load"
and phrases, typed text and read aloud keep working.
