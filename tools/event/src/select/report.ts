// tools/event/out/report.md: every row's status and why, for the organisers. Contains usernames. Owned by #56.
import type { EventAiStats } from '../lib/ai.ts';
import type { ReportEntry, SelectionRun, Status } from './run.ts';

const STATUS_ORDER: readonly Status[] = [
  'picked',
  'runnerUp',
  'notShortlisted',
  'unscored',
  'unsafe',
  'ip',
  'needsNewMechanics',
  'tooVague',
  'injectionOnly',
  'screenFailed',
  'noPrompt',
  'duplicatePrompt',
  'duplicate',
  'invalid',
];

/** Untrusted text as inert Markdown on one line: no links, images, HTML or table breaks. */
export function escapeMd(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_[\]()|#!~]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/:\/\//g, ':&#8203;//')
    .trim();
}

const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join(
    '\n',
  );

const entryRow = (e: ReportEntry) => [
  String(e.row),
  escapeMd(e.username),
  e.status,
  e.score === null ? '' : String(e.score),
  e.injection ? 'INJECTION' : '',
  escapeMd(e.reason),
];

export function renderReport(run: SelectionRun, stats: EventAiStats, mock: boolean): string {
  const { entries, selection, error } = run;
  const count = (s: Status) => entries.filter((e) => e.status === s).length;
  const injected = entries.filter((e) => e.injection);
  const duplicates = entries.filter((e) => e.status === 'duplicate');
  const names = new Map(entries.map((e) => [e.submissionId, e.username]));
  const parts = [
    '# Event selection report',
    '',
    '> Private: contains usernames. Share with organisers only; never commit it.',
    '',
    mock ? '**Mock run** (no real AI calls; costs are simulated).' : '',
    `AI calls: ${stats.calls}, cache hits: ${stats.cacheHits}, cost this run: $${stats.costUsd.toFixed(4)}.`,
    '',
    '## Picks',
    '',
  ];
  if (selection) {
    parts.push(
      table(
        ['#', 'Theme', 'Username', 'Setting', 'Score', 'Why'],
        selection.picks.map((p) => [
          String(p.rank),
          escapeMd(p.titleIdea),
          escapeMd(names.get(p.submissionId) ?? ''),
          escapeMd(p.settingTags[0]),
          String(p.scores.total),
          escapeMd(p.reason),
        ]),
      ),
    );
    if (selection.relaxed.length) parts.push('', `**Rules relaxed:** ${selection.relaxed.join('; ')}.`);
  } else {
    parts.push(`**No selection:** ${error}.`);
  }
  parts.push(
    '',
    '## Counts',
    '',
    table(
      ['Status', 'Rows'],
      STATUS_ORDER.filter(count).map((s) => [s, String(count(s))]),
    ),
    '',
    '## Duplicate usernames',
    '',
    duplicates.length
      ? duplicates.map((e) => `- row ${e.row} (${escapeMd(e.username)}): ${escapeMd(e.reason)}`).join('\n')
      : 'None.',
    '',
    '## Injection flags',
    '',
    injected.length ? injected.map((e) => `- row ${e.row} (${escapeMd(e.username)}): ${e.status}`).join('\n') : 'None.',
    '',
    '## All submissions',
    '',
    table(['Row', 'Username', 'Status', 'Score', 'Flag', 'Reason'], entries.map(entryRow)),
    '',
  );
  return parts.join('\n');
}
