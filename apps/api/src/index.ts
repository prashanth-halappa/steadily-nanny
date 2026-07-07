import app from './app';
import config from './config/config';
import { phClient } from './config/posthog';
import { logger } from './middlewares/logger';

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.port}`);
});

// Graceful shutdown — flush buffered analytics so events aren't lost when the
// container is killed.
const shutdown = () => {
  logger.info('Shutting down...');
  void phClient.shutdown();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
