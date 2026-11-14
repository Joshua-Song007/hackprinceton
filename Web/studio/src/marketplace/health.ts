// Polls a plugin runtime's /health until it answers 200. The first `uv sync` is slow, hence the 60 s default.
export const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 1_000;

export async function waitHealthy(
  url: string,
  { fetchFn = (...a: Parameters<typeof fetch>) => fetch(...a), timeoutMs = HEALTH_TIMEOUT_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += HEALTH_INTERVAL_MS) {
    try {
      if ((await fetchFn(url)).ok) return;
    } catch {
      // the runtime is not listening yet
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  throw new Error(`The runtime did not answer ${url} within ${Math.round(timeoutMs / 1000)} s`);
}
