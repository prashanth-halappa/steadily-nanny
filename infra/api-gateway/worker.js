/**
 * Reverse proxy: api.nanny.getsteadily.app -> the Cloud Run service.
 *
 * Cloud Run routes on the Host header, so it has to be rewritten to the run.app
 * hostname; the original host is preserved in X-Forwarded-Host. Same shape as
 * the steadily-api-gateway worker that fronts api.getsteadily.app.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set('Host', new URL(env.CLOUD_RUN_ORIGIN).hostname);
    headers.set('X-Forwarded-Host', url.hostname);

    const response = await fetch(
      `${env.CLOUD_RUN_ORIGIN}${url.pathname}${url.search}`,
      { method: request.method, headers, body: request.body }
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
