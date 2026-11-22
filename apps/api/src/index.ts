// Bun-only local entry (`bun src/index.ts`). Production runs src/worker.ts on
// Cloudflare Workers.
import app from './app';
import config from './config/config';
import { logger } from './middlewares/logger';

app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.port}`);
});
