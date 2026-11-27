// Prompt-injection detection for untrusted submissions. Owned by #56.
// Sentences that address the judge are removed before any model sees the prompt, and the submission is
// flagged (and penalised in scoring), so an injected copy can never outrank its clean version.

const PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|other|system|your)\b.{0,30}\b(instructions?|prompts?|rules?|messages?|guidelines?)\b/i,
  /\b(system|developer)\s*(prompt|message|instructions?)\b/i,
  /\byou are (now )?(an? |the )?(ai|assistant|judge|model|language model|llm|chatbot)\b/i,
  /\b(as an ai|as the judge|dear (ai|judge|model))\b/i,
  /\b(score|rate|rank|grade|mark)\b.{0,30}\b(10|ten|highest|maximum|max|perfect|top|first|1st)\b/i,
  /\b(pick|select|choose|rank)\b.{0,20}\b(this|me|mine|my (idea|game|prompt|submission))\b.{0,30}\b(first|winner|top|1st|number one|#1|above)\b/i,
  /\b(this|my) (submission|prompt|idea|entry) (must|should|has to) (win|be (picked|chosen|selected|first))\b/i,
  /<\/?\s*(system|assistant|user|data|instructions?|im_start|im_end)\s*>/i,
  /\[\s*(system|inst|\/inst)\s*\]/i,
  /^\s*(#{2,}|system:|assistant:)/im,
];

/** True if the text contains an attempt to instruct the model. */
export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((re) => re.test(text));
}

/** Split into sentences (keeping their punctuation) and drop the ones that address the model. */
export function stripInjection(text: string): { clean: string; flagged: boolean } {
  const sentences = text.match(/[^.!?\n]+[.!?]*|\n+/g) ?? [];
  let flagged = false;
  const kept: string[] = [];
  for (const s of sentences) {
    if (looksLikeInjection(s)) flagged = true;
    else if (s.trim()) kept.push(s.trim());
  }
  if (!flagged && looksLikeInjection(text)) flagged = true; // a pattern spanning sentences
  return { clean: flagged ? kept.join(' ').trim() : text, flagged };
}
