export interface SourceHealth {
  label: string;
  status: "fresh" | "stale" | "unavailable" | "partial";
  lastSuccessAt: string | null;
  attemptedAt: string;
  message?: string;
}
export function health(label: string, attemptedAt: string, ok: boolean, previous?: SourceHealth, message?: string): SourceHealth {
  const lastSuccessAt = ok ? attemptedAt : previous?.lastSuccessAt ?? null;
  return { label, status: ok ? "fresh" : lastSuccessAt ? "stale" : "unavailable", lastSuccessAt, attemptedAt, ...(message ? { message } : {}) };
}
// Keep upstream URLs and credentials out of user-visible errors.
export function publicError(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/429|too many|rate.limit/i.test(message)) return "Provider is rate-limiting requests. Try again shortly.";
  if (/timeout|abort/i.test(message)) return "Provider took too long to respond.";
  return message.replace(/https?:\/\/[^\s]+/g, "[provider]").slice(0, 240);
}
