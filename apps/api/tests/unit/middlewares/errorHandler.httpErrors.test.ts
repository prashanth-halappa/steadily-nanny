/**
 * Errors created by express/body-parser (http-errors) carry `status` +
 * `expose`. Exposed 4xx must keep their status; everything else stays a
 * generic 500 with no message leak.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { errorHandler } from '../../../src/middlewares/errorHandler';

let server: Server;
let base: string;
const originalNodeEnv = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/api/v1/echo', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/v1/hidden', () => {
    throw Object.assign(new Error('secret 4xx detail'), {
      status: 403,
      expose: false,
    });
  });
  app.get('/api/v1/exposed-5xx', () => {
    throw Object.assign(new Error('secret 5xx detail'), {
      status: 503,
      expose: true,
    });
  });
  app.use(errorHandler);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  process.env.NODE_ENV = originalNodeEnv;
});

async function post(contentType: string, body: string) {
  const res = await fetch(`${base}/api/v1/echo`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  return { status: res.status, body: await res.json() };
}

describe('errorHandler honours exposed express/body-parser 4xx', () => {
  test('unsupported charset → 415', async () => {
    const { status, body } = await post('application/json; charset=foo', '{}');
    expect(status).toBe(415);
    expect(body.success).toBe(false);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.code).toBeDefined();
    expect(body.error.name).toBeDefined();
    expect(body.error.stack).toBeUndefined();
    expect(body.path).toBe('/api/v1/echo');
    expect(body.timestamp).toBeDefined();
  });

  test('entity.too.large → 413', async () => {
    const { status, body } = await post(
      'application/json',
      JSON.stringify({ x: 'a'.repeat(5000) })
    );
    expect(status).toBe(413);
    expect(body.error.message).toBe('Request payload is too large');
  });

  test('malformed JSON → 400', async () => {
    const { status, body } = await post('application/json', '{not json');
    expect(status).toBe(400);
    expect(body.error.message).toBe('Request body contains malformed JSON');
  });

  test('non-exposed 4xx → generic 500, no leak', async () => {
    const res = await fetch(`${base}/api/v1/hidden`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.message).toBe('An unexpected error occurred');
    expect(text).not.toContain('secret');
  });

  test('exposed 5xx → generic 500, no leak', async () => {
    const res = await fetch(`${base}/api/v1/exposed-5xx`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.message).toBe('An unexpected error occurred');
    expect(text).not.toContain('secret');
  });
});
