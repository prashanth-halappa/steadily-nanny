// Minimal typing for the Workers-only `cloudflare:node` module (the full
// @cloudflare/workers-types would clash with bun-types' globals).
declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
}
