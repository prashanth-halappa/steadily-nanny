/**
 * Widget domain barrel — the example feature's public surface.
 *
 * @module domains/widget
 */
export * from './controllers/widgetController';
export * from './errors/widgetErrors';
export { runWidgetDigestJob } from './jobs/widgetDigestJob';
export * from './repositories/widgetRepository';
export { default as widgetRoutes } from './routes/widgetRoutes';
export * from './schemas';
export * from './services/widgetCommandService';
export * from './services/widgetQueryService';
