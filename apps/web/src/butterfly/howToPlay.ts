// How-to-play card (#84): shown during the countdown. Controls ONLY: the butterfly effect is a surprise
// players discover during the race and on the results screen, so none of it is mentioned here.

export interface HowToLine {
  icon: string;
  text: string;
}

export const HOW_TO_PLAY: readonly HowToLine[] = Object.freeze([
  { icon: '🕹️', text: 'Joystick (left) or WASD: run' },
  { icon: '⤒', text: 'Jump (right) or Space' },
  { icon: '👊', text: 'Grab (right) or E: push someone standing' },
  { icon: '✋', text: 'Grab: save someone falling' },
  { icon: '🤝', text: 'Grab: help up someone knocked down' },
]);

/** Builds the card. Static DOM, built once. */
export function createHowToPlayCard(doc: Document): HTMLElement {
  const card = doc.createElement('aside');
  card.className = 'wr-howto';
  card.setAttribute('aria-label', 'How to play');
  const list = doc.createElement('ul');
  for (const line of HOW_TO_PLAY) {
    const li = doc.createElement('li');
    const icon = doc.createElement('span');
    icon.className = 'wr-howto-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = line.icon;
    li.append(icon, doc.createTextNode(line.text));
    list.append(li);
  }
  card.append(list);
  return card;
}
