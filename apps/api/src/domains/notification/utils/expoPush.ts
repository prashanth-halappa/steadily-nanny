/**
 * Minimal Expo push client over `fetch` (workerd-safe; replaces expo-server-sdk).
 *
 * @module domains/notification/utils/expoPush
 */

export type ExpoPushMessage = {
  to: string;
  sound?: 'default' | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};

export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | {
      status: 'error';
      message: string;
      details?: { error?: string; [key: string]: unknown };
    };

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH = 100;
const UUID_TOKEN = /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i;

/** Same semantics as expo-server-sdk's `Expo.isExpoPushToken`. */
export function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    (((token.startsWith('ExponentPushToken[') ||
      token.startsWith('ExpoPushToken[')) &&
      token.endsWith(']')) ||
      UUID_TOKEN.test(token))
  );
}

/** Split messages into Expo-sized (≤100) batches. */
export function chunk<T>(items: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** POST one batch; returns tickets aligned 1:1 with `messages`. Throws on failure. */
export async function sendPush(
  messages: ExpoPushMessage[]
): Promise<ExpoPushTicket[]> {
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: ExpoPushTicket[];
    errors?: { message?: string }[];
  };
  if (json.errors?.length) {
    throw new Error(
      `Expo push error: ${json.errors.map(e => e.message ?? 'unknown').join('; ')}`
    );
  }
  if (!Array.isArray(json.data))
    throw new Error('Expo push: malformed response');
  return json.data;
}
