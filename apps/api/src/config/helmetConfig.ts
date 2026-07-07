import type { HelmetOptions } from 'helmet';

// Helmet configuration optimized for a mobile-only JSON API.
const helmetConfig: HelmetOptions = {
  hidePoweredBy: true, // Hide X-Powered-By (prevents fingerprinting)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true, // X-Content-Type-Options: nosniff

  // Minimal CSP for an API surface.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },

  // Browser-specific headers not needed for a mobile API.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  xssFilter: false,
  frameguard: false,
};

export default helmetConfig;
