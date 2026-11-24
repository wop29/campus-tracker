export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
/** POST JSON and normalise errors (including 401, 503 not_configured and 502 bad_model_output) into a readable message. */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (json && (json.message || json.error)) || `Request failed (${res.status})`, code: json?.error };
    return { ok: true, data: json as T };
  } catch (e) { return { ok: false, error: `Network error: ${(e as Error).message}` }; }
}
