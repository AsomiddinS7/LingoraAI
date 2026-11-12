// Inline stroke icons (decorative: always paired with visible text).
const PATHS: Record<string, string> = {
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4.6 16.6a1.6 1.6 0 0 1 2.5-2L8 15.6',
  speaker: 'M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Zm0 16A2.5 2.5 0 0 1 6.5 19H20',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-6v-5m0-3h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm7-3a7 7 0 0 1-14 0m7 7v3',
  camera: 'M15 10l5-3v10l-5-3M4 6h11v12H4z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 5v14l11-7L7 5Z',
  stop: 'M7 7h10v10H7z',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.6-1.9M2 9.5a15 15 0 0 1 4.3-2.8M22 9.5A15 15 0 0 0 11 5.6M12 20h.01',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  question: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.5-13a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8m0-4v4h4m-4 5a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#0b5c55" />
      <path d="M9 18V11.5a1.4 1.4 0 0 1 2.8 0V16m0-5.5v-1a1.4 1.4 0 0 1 2.8 0V16m0-5a1.4 1.4 0 0 1 2.8 0v5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M17.4 14.5a1.4 1.4 0 0 1 2.8 0V18a5.5 5.5 0 0 1-5.5 5.5h-.9a5 5 0 0 1-3.8-1.8L8 19.2" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="9" r="3" fill="#f2b84b" />
    </svg>
  );
}
