// WOBBLE_AI_MOCK=1: procedural drafts, approving QA verdicts and locally drawn images. No network (#59).
import { placeholderImage } from '../images/placeholder.ts';
import type { ImageKind } from '../images/process.ts';
import type { ImageCall, MockResponders } from './ai.ts';
import { seedFrom } from '../lib/hash.ts';
import { proceduralDraft } from './procedural.ts';
import type { Pick } from './selection.ts';

/** The kind of picture a slot id stands for. */
export function slotKind(id: string): ImageKind {
  const first = id.split('-')[0];
  return first === 'skybox' || first === 'texture' || first === 'sprite' || first === 'signage' ? first : 'card';
}

function mockImage(call: ImageCall): Promise<Buffer> {
  const chroma = call.prompt.includes('#00FF00') ? 'green' : 'magenta';
  const colors = (call.prompt.match(/#[0-9a-f]{6}/g) ?? []).slice(0, 6);
  return placeholderImage({ kind: slotKind(call.name), palette: colors, chroma, seed: seedFrom(call.prompt) });
}

export const mockResponders: MockResponders = {
  object(name, input) {
    const draft = proceduralDraft((input as { pick: Pick }).pick);
    if (name === 'look' || name === 'repair-look') return draft.look;
    if (name.startsWith('props') || name === 'repair-props') return draft.props;
    throw new Error(`no mock answer for "${name}"`);
  },
  vision(name) {
    if (name === 'readability') {
      return { pathReadable: true, hazardsReadable: true, bouncyReadable: true, notes: 'mock' };
    }
    return { pass: true, matchesBrief: true, hasTextOrLogo: false, unsafe: false, styleFit: 'good', notes: '' };
  },
  image: mockImage,
};
