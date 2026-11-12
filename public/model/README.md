# /model (owned by the team)

Put the classifier here. The app loads it only when `VITE_SIGN_CLASSIFIER=model`
(or `signClassifier = model` in the Console).

Loader hook contract: `public/model/classifier.js` is an ES module that exports

```js
export function createClassifier() {
  return {
    async load() { /* fetch model files from ./model/, warm up */ },
    attach(video, onSign) { /* read frames from the <video>; call onSign({ label, confidence }) once per stable sign */ },
    detach() { /* stop */ },
  };
}
```

`label` must be a label from `src/data/vocabulary.json` or `'none'`. Video frames must stay on the device.
If this file is missing or `load()` throws, the app shows "Sign recognition did not load"
and phrases, typed text and read aloud keep working.
