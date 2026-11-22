import type { Request, RequestHandler } from 'express';
import { env } from '../config/env';
import Sentry from '../config/sentry';
import { BaseError, isExpectedClientError } from '../errors';
import { redactLoggedUrl } from '../utils/redactLoggedUrl';

/**
 * True when a structured log's meta denotes an EXPECTED operational client error
 * (4xx). Such logs are handled request flow, not bugs, and must not be reported
 * to Sentry. Conservative by design.
 */
const metaDenotesExpectedClientError = (
  meta: Record<string, unknown>
): boolean => {
  if (isExpectedClientError(meta.error)) {
    return true;
  }

  const candidates: unknown[] = [meta, meta.error, meta.metadata];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.statusCode === 'number' &&
      record.statusCode >= 400 &&
      record.statusCode < 500 &&
      record.isOperational === true
    ) {
      return true;
    }
  }

  return false;
};

type Level = 'error' | 'warn' | 'info' | 'http' | 'debug';

// npm-style ordering (lower = more severe), as winston had it.
const LEVELS: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const SENTRY_LEVEL: Record<Level, Sentry.SeverityLevel> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  http: 'info',
  debug: 'debug',
};

type LogFn = (message: string, ...meta: unknown[]) => Logger;

/** Console-based logger (Workers-safe); same call signature winston had. */
export interface Logger {
  level: string;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  http: LogFn;
  debug: LogFn;
}

const makeLogger = (level: string): Logger => {
  const threshold = LEVELS[level as Level] ?? LEVELS.info;
  const emit =
    (lvl: Level): LogFn =>
    (message, ...rest) => {
      if (LEVELS[lvl] > threshold) return logger;
      const sink = lvl === 'debug' || lvl === 'http' ? 'log' : lvl;
      console[sink](`${lvl}: ${message}`, ...rest);
      // Error logs mirror to Sentry; expected operational 4xx stay out.
      const first = rest[0];
      const meta: Record<string, unknown> =
        first !== null && typeof first === 'object'
          ? (first as Record<string, unknown>)
          : { detail: first };
      if (lvl === 'error' && !metaDenotesExpectedClientError(meta)) {
        Sentry.captureMessage(message, {
          level: SENTRY_LEVEL[lvl],
          extra: meta,
        });
      }
      return logger;
    };
  const logger: Logger = {
    level,
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    http: emit('http'),
    debug: emit('debug'),
  };
  return logger;
};

export const logger = makeLogger(env.LOG_LEVEL);

// Access lines log at `http` level — below `info` in the default order. At
// LOG_LEVEL=info (the production default) they're suppressed entirely, so
// payroll/business errors (logged at `warn`/`error`) aren't buried in
// per-request noise. Set LOG_LEVEL=debug to see them — `bun run dev` does this
// so logs/dev.log keeps full request/response cycles as documented in CLAUDE.md.
export const logHttpAccess = (message: string): void => {
  logger.http(message.trim());
};

/** The access-log `:url`, with an invite code never reaching the log. */
export const redactedUrlToken = (req: Request): string =>
  redactLoggedUrl(req.originalUrl || req.url || '');

/** HTTP access log middleware (replaces morgan). */
export const morganMiddleware: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const len = res.getHeader('content-length') ?? '-';
    logHttpAccess(
      `${req.method} ${redactedUrlToken(req)} ${res.statusCode} ${len} - ${Date.now() - start} ms`
    );
  });
  next();
};

/** Enrich and emit a structured error log. */
export const logError = (error: Error, req: Request): void => {
  const errorLog: {
    message: string;
    stack?: string;
    path: string;
    method: string;
    [key: string]: unknown;
  } = {
    message: error.message,
    stack: error.stack,
    path: redactLoggedUrl(req.path),
    method: req.method,
    requestId: req.id,
    timestamp: new Date().toISOString(),
  };

  if (error instanceof BaseError) {
    errorLog.errorCode = error.code;
    errorLog.statusCode = error.statusCode;
    errorLog.isOperational = error.isOperational;
    if (error.metadata) {
      errorLog.metadata = error.metadata;
    }
  }

  if (req.user) {
    errorLog.userId = req.user.id;
  }

  // Operational 4xx are expected flow — log at warn without a stack; 5xx and
  // non-operational errors at error with a full stack.
  const isOperational4xx =
    error instanceof BaseError &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.isOperational;

  if (isOperational4xx) {
    errorLog.stack = undefined;
    logger.warn('Request failed:', errorLog);
  } else {
    logger.error('Error occurred:', errorLog);
  }
};
