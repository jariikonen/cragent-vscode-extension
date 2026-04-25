import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  minify: production,
  // Prefer the CJS condition so the SDK's wildcard exports resolve to .js files
  conditions: ['require', 'node'],
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[esbuild] watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('[esbuild] build complete');
}
