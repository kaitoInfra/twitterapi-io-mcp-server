/**
 * twitterapi.io REST API client wrapper.
 *
 * - Auth: TWITTERAPI_IO_API_KEY env var → X-API-Key header
 * - Base URL: https://api.twitterapi.io
 * - Retry: exponential backoff for 429 / 5xx (3 attempts, 1s/2s/4s)
 * - Timeout: 30s per request
 * - Logging: stderr only (stdout reserved for MCP JSON-RPC)
 */

const BASE_URL = "https://api.twitterapi.io";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export class TwitterApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "TwitterApiError";
  }
}

function log(...args: unknown[]): void {
  // stderr per MCP spec (stdout is JSON-RPC channel)
  console.error("[twitterapi-mcp]", ...args);
}

function buildUrl(path: string, params: Record<string, unknown>): string {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * GET twitterapi.io endpoint with X-API-Key auth + retry on 429/5xx.
 *
 * @param path - endpoint path (e.g. "/twitter/tweet/advanced_search")
 * @param params - query params (undefined values skipped)
 * @returns parsed JSON response
 * @throws TwitterApiError on non-2xx after retries
 */
export async function twitterApiGet(
  path: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.TWITTERAPI_IO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TWITTERAPI_IO_API_KEY env var not set. Get a key at https://twitterapi.io and add it to your MCP client config.",
    );
  }

  const url = buildUrl(path, params);
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
          "User-Agent": "twitterapi-io-mcp-server/0.1.0",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      // success
      if (r.ok) {
        return await r.json();
      }

      // 4xx (non-429) → no retry, throw
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        const body = await r.text();
        throw new TwitterApiError(
          `twitterapi.io ${r.status}: ${body.slice(0, 500)}`,
          r.status,
          path,
        );
      }

      // 429 or 5xx → retry with backoff
      const backoff = 1000 * 2 ** attempt; // 1s, 2s, 4s
      log(
        `${path} attempt ${attempt + 1}/${MAX_RETRIES} got ${r.status}, retry in ${backoff}ms`,
      );
      lastErr = new TwitterApiError(
        `twitterapi.io ${r.status} after ${attempt + 1} attempts`,
        r.status,
        path,
      );
      await sleep(backoff);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof TwitterApiError) throw e;
      // network / timeout → retry
      const backoff = 1000 * 2 ** attempt;
      log(`${path} attempt ${attempt + 1}/${MAX_RETRIES} threw ${e}, retry in ${backoff}ms`);
      lastErr = e as Error;
      if (attempt < MAX_RETRIES - 1) await sleep(backoff);
    }
  }

  throw lastErr ?? new Error(`${path} failed after ${MAX_RETRIES} attempts`);
}
