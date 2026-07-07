import type { Request } from 'express';
import morgan from 'morgan';
import winston from 'winston';
import Transport from 'winston-transport';
import Sentry from '../config/sentry';
import { BaseError, isExpectedClientError } from '../errors';

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

/** Winston transport that mirrors error logs to Sentry. */
export class SentryTransport extends Transport {
  log(info: winston.LogEntry, callback: () => void) {
    const { level, message, ...meta } = info;

    // Suppress expected operational 4xx logs so genuine 5xx bugs stay visible.
    if (metaDenotesExpectedClientError(meta)) {
      callback();
      return;
    }

    Sentry.captureMessage(message, {
      level: this.getSentryLevel(level),
      extra: meta,
    });

    callback();
  }

  private getSentryLevel(level: string): Sentry.SeverityLevel {
    const levels: { [key: string]: Sentry.SeverityLevel } = {
      error: 'error',
      warn: 'warning',
      info: 'info',
      debug: 'debug',
    };
    return levels[level] || 'info';
  }
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new SentryTransport({ level: 'error' }),
  ],
});

/** Morgan HTTP access log → winston. */
export const morganMiddleware = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: {
      write: (message: string) => {
        logger.info(message.trim());
      },
    },
  }
);

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
    path: req.path,
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
