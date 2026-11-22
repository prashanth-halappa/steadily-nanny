// Minimal typing for the Workers-only `cloudflare:node` module (the full
// @cloudflare/workers-types would clash with bun-types' globals).
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}

// `cloudflare:workers` env typing. D1Database is declared structurally here for
// the same bun-types clash reason; drizzle-orm/d1 accepts it.
declare module 'cloudflare:workers' {
  export const env: {
    DB: import('drizzle-orm/d1').AnyD1Database;
    [key: string]: unknown;
  };
}
