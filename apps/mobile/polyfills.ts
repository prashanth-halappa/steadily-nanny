// AI SDK / streaming polyfills for React Native (Hermes).
// Must be imported at the very top of src/app/_layout.tsx, before any other
// import — the globals below have to exist before anything touches them.
//
// SETUP: if you do not use streaming/AI features you can delete the body, but
// keep this file imported first as the reserved slot for any future global shim.

// Check if we're NOT in a web environment (no document object)
const isNative = typeof document === 'undefined';

if (isNative) {
  // Polyfill structuredClone for AI SDK message handling
  if (typeof globalThis.structuredClone === 'undefined') {
    const structuredClonePolyfill = require('@ungap/structured-clone').default;
    (globalThis as Record<string, unknown>).structuredClone =
      structuredClonePolyfill;
  }

  // Polyfill TextEncoderStream and TextDecoderStream for streaming responses
  if (typeof globalThis.TextEncoderStream === 'undefined') {
    const {
      TextEncoderStream,
      TextDecoderStream,
    } = require('@stardazed/streams-text-encoding');
    (globalThis as Record<string, unknown>).TextEncoderStream =
      TextEncoderStream;
    (globalThis as Record<string, unknown>).TextDecoderStream =
      TextDecoderStream;
  }
}
