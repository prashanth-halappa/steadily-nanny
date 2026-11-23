/**
 * iOS keeps idle HTTPS connections pooled; Cloudflare's edge closes them
 * sooner. The next POST on a dead connection fails at once with "The network
 * connection was lost" (NSURLErrorNetworkConnectionLost) — URLSession retries
 * only idempotent methods by itself. Seen on sign-in/sign-out after a quiet
 * spell: the request never reached the Worker. Retry exactly that error, once,
 * on a fresh connection.
 */
export const isLostConnection = (error: unknown): boolean =>
  error instanceof Error && /network connection was lost/i.test(error.message);

export const fetchRetryingLostConnection = (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> =>
  fetch(input, init).catch((error: unknown) => {
    if (!isLostConnection(error)) throw error;
    return fetch(input, init);
  });
