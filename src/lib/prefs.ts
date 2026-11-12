// Browser storage only for harmless preferences, always inside try/catch (brief sections 11, 13).
const PREFIX = 'signconnect.';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage blocked: preference simply is not remembered */
  }
}
