// Babel config for an Expo + NativeWind 4 app.
// - babel-preset-expo with `jsxImportSource: 'nativewind'` makes JSX emit
//   NativeWind-aware elements (so `className` works on RN components).
// - `nativewind/babel` enables the className -> style transform.
// - module-resolver mirrors the tsconfig `@/` path alias so runtime resolution
//   matches type-checking. Keep `tailwind.config` aliased so NativeWind can read it.
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

          alias: {
            '@': './',
            'tailwind.config': './tailwind.config.js',
          },
        },
      ],
    ],
  };
};
