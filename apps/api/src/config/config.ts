/**
 * Application configuration.
 *
 * A small typed view over the validated `env` (see `env.ts`). Import this for
 * runtime config; import `env` directly only when you need a raw variable.
 */
import { env, isDevelopment, isProduction, isTest } from './env';

interface Config {
  port: number;
  nodeEnv: string;
  logLevel: string;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

const config: Config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  isProduction,
  isDevelopment,
  isTest,
};

export default config;
