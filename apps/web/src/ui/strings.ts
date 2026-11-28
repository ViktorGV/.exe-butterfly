// Every user-visible string in the UI. Placeholders look like {name} and are filled by t().

export const STRINGS = {
  appName: 'Flutter 3D',
  wordmarkTop: 'Flutter',
  wordmarkBottom: '',
  wordmarkBadge: '3D',
  tagline: 'Wobble. Dive. Qualify.',

  nameLabel: 'Your name',
  nameLabelEvent: 'Your username',
  namePlaceholder: 'Wobbler',
  defaultName: 'Wobbler',
  quickPlay: 'Join room',
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
  actionGrab: 'Push / grab (near a player)',
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
  keyGrab: 'E',
  keyCamera: 'Mouse drag',
  keyPause: 'Esc',
  padMove: 'Left stick or d-pad',
  padJump: 'A',
  padDive: 'B or X',
  padGrab: 'Y',
  padCamera: 'Right stick',
  padPause: 'Start',

  hintTouch: 'Drag left to move · tap JUMP and DIVE',
  hintKeyboard: 'WASD to move · Space to jump · Shift to dive · E to push',
  hintGamepad: 'Stick to move · A to jump · B to dive · Y to push',

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

  // Butterfly effect (#84): results lines and titles, built by butterfly/summary.ts.
  bfOwnSaved: 'you saved {n}',
  bfOwnPushed: 'you pushed {n}',
  bfOwnPushedToo: 'pushed {n}', // after "you saved N and"
  bfOwnHero: 'the hero opened a bridge for you',
  bfOwnMarked: 'you were marked',
  bfOwnHit: "the villain's throw got you",
  bfOwnHitMany: "the villain's throws got you {n} times",
  bfOwnDodged: 'you dodged every throw',
  bfLobbyTotals: '{pushes} pushes, {saves} saves',
  bfLobbyFalls: '{n} push falls',
  bfLobbyStorm: 'the storm reached {level} of {max} and {power}',
  bfPowerNone: 'the villain never woke',
  bfPowerLow: 'the villain was just stirring',
  bfPowerMid: 'the villain was getting strong',
  bfPowerHigh: 'the villain was nearly at full power',
  bfPowerFull: 'the villain was at full power',
  bfTitleFastest: 'Fastest',
  bfTitleKindest: 'Kindest',
  bfTitleBiggest: 'Biggest butterfly',
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
