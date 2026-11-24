export function countWords(text: string | null | undefined): number {
  const t = (text ?? '').trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}
export function wordLimitState(words: number, limit?: number | null): 'none' | 'ok' | 'near' | 'over' {
  if (!limit) return 'none';
  return words > limit ? 'over' : words >= limit * 0.9 ? 'near' : 'ok';
}
