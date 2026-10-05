// All callers in sources/ are read-only, including JSON-RPC POSTs.
export async function readFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await globalThis.fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12000) });
      if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 700));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt > 0 || init?.signal?.aborted) throw error;
    }
  }
}
