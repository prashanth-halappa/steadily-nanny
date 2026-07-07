module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
        },
      ],
      'nativewind/babel',
    ],

    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],

          // Dual root aliases: both `@/` and `~/` resolve to the app ROOT
          // (not src/). Keep in sync with the `paths` in tsconfig.json.
          alias: {
            '@': './',
            '~': './',
            'tailwind.config': './tailwind.config.js',
          },
        },
      ],
    ],
  };
};
