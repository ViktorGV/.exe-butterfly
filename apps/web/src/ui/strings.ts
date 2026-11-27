// Every user-visible string in the UI. Placeholders look like {name} and are filled by t().

export const STRINGS = {
  appName: 'Wobble Rush 3D',
  wordmarkTop: 'Wobble',
  wordmarkBottom: 'Rush',
  wordmarkBadge: '3D',
  tagline: 'Wobble. Dive. Qualify.',

  nameLabel: 'Your name',
  nameLabelEvent: 'Your username',
  namePlaceholder: 'Wobbler',
  defaultName: 'Wobbler',
  quickPlay: 'Quick Play',
  joinWithCode: 'Join with code',
  createRoom: 'Create room',
  soloPractice: 'Solo practice',
  settings: 'Settings',
  codeLabel: 'Room code',
  codePlaceholder: 'ABCDE',
  join: 'Join',
  cancel: 'Cancel',
  codeInvalid: 'Room codes are 5 letters.',

  loading: 'Loading…',

  go: 'GO!',

  hudTime: 'Time',
  hudCheckpoint: 'Checkpoint',
  hudPlace: 'Place',
  hudQualified: 'Qualified',
  pause: 'Pause',

  paused: 'Paused',
  resume: 'Resume',
  restart: 'Restart',
  leave: 'Leave race',
  done: 'Done',
  volume: 'Volume',
  volumeMaster: 'Master',
  volumeMusic: 'Music',
  volumeSfx: 'Effects',
  controls: 'Controls',
  controlsTouch: 'Touch',
  controlsKeyboard: 'Keyboard',
  controlsGamepad: 'Gamepad',
  actionMove: 'Move',
  actionJump: 'Jump',
  actionDive: 'Dive',
  actionCamera: 'Camera',
  actionPause: 'Pause',
  touchMove: 'Drag on the left half',
  touchJump: 'Big round button',
  touchDive: 'Small round button',
  touchCamera: 'Drag on the right half',
  touchPause: 'Pause button, top right',
  keyMove: 'WASD or arrow keys',
  keyJump: 'Space',
  keyDive: 'Shift',
  keyCamera: 'Mouse drag',
  keyPause: 'Esc',
  padMove: 'Left stick or d-pad',
  padJump: 'A',
  padDive: 'B or X',
  padCamera: 'Right stick',
  padPause: 'Start',

  hintTouch: 'Drag left to move · tap JUMP and DIVE',
  hintKeyboard: 'WASD to move · Space to jump · Shift to dive',
  hintGamepad: 'Stick to move · A to jump · B to dive',

  toastCheckpoint: 'Checkpoint!',

  finishQualified: 'Qualified!',
  finishFinished: 'Finished',
  finishTimeUp: "Time's up",
  finishEliminated: 'Eliminated',
  personalBest: 'Personal best {time}',
  newPersonalBest: 'New personal best!',

  results: 'Results',
  resultsYouPlaced: 'You placed {place}',
  resultsQualified: 'Qualified',
  resultsEliminated: 'Eliminated',
  resultsPlace: '#',
  resultsName: 'Player',
  resultsTime: 'Time',
  resultsFindMe: 'Find me',
  resultsBack: 'Back to menu',
  resultsAgain: 'Race again',
  you: 'you',

  errorTitle: 'Something went wobbly',
  errorRetry: 'Try again',
  errorBack: 'Back to menu',
  reconnecting: 'Reconnecting…',
  reconnectingBody: 'Hold tight, we lost the connection for a moment.',
} as const;

export type StringKey = keyof typeof STRINGS;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Look up a string and fill {placeholders} from vars. Unknown placeholders are left as-is. */
export function t(key: StringKey, vars?: Readonly<Record<string, string | number>>): string {
  const s: string = STRINGS[key];
  if (!vars) return s;
  return s.replace(PLACEHOLDER, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
