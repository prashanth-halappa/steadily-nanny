import app from './app';
import config from './config/config';
import { logger } from './middlewares/logger';

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.port}`);
});

const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
