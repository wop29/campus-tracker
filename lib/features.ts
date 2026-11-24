// Feature switches the whole app reads. Safe in the browser and on the server.
//
// AI features are OFF unless the app owner turns them on with NEXT_PUBLIC_AI_ENABLED=1 (a public build-time flag,
// so client components can hide AI buttons without a network round trip). Server routes should use
// aiServerEnabled(), which also needs the Anthropic key to be present.
//
// Never show env var names to students. Use AI_OFF_MESSAGE (or hide the control) instead.

/** True when AI buttons and panels should be shown. Reads a public flag, so it works in client components. */
export function aiEnabled(): boolean {
  // Must be written out in full: Next.js inlines NEXT_PUBLIC_ values only for literal property access.
  return process.env.NEXT_PUBLIC_AI_ENABLED === '1';
}

/** Server only in practice: the public flag is on AND the Anthropic key exists. Returns false in the browser. */
export function aiServerEnabled(): boolean {
  return aiEnabled() && Boolean(process.env.ANTHROPIC_API_KEY);
}

/** What a student sees if they somehow reach an AI action while AI is off or not set up. */
export const AI_OFF_MESSAGE = 'AI feedback is coming soon. Everything else in the app works as usual.';
