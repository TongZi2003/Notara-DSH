import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { patchDshHost } from './patch-dsh-chat.mjs';
import { writeNotices } from './release-notices.mjs';

await patchDshHost();

const require = createRequire(import.meta.url);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allPlugins = ['presets', 'vault-sqlite', 'home-recommend', 'vault-views', 'graph-and-blocks', 'pomodoro', 'calendar'];
const plugins = process.argv.length > 2 ? process.argv.slice(2) : allPlugins;
if (plugins.some(name => !allPlugins.includes(name))) throw new Error('Unknown plugin requested');
for (const folder of plugins) {
  const directory = resolve(root, 'plugins', folder);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (folder === 'presets') {
    await import(new URL('../plugins/presets/scripts/sync-resources.mjs', import.meta.url));
  }
  if (!manifest.dsh?.client) continue;
  const entry = resolve(directory, 'src/client.jsx');
  await access(entry);
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', metafile: true,
    platform: 'browser', target: 'es2022', jsx: 'automatic',
    conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
    loader: { '.css': 'text' }, legalComments: 'eof', logLevel: 'warning',
    plugins: [{ name: 'bundled-workspace-path', setup(builder) {
      // This browser-safe utility has no ModuleLoader client entry of its own.
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-util-workspace-path$/ }, () => ({ path: require.resolve('@deepseek-ai/dsh-util-workspace-path') }));
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-agent-preset-registry\/display$/ }, () => ({ path: require.resolve('@deepseek-ai/dsh-agent-preset-registry/display') }));
    } }, { name: 'bundled-css-text', setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, async args => {
        const css = await build({ entryPoints: [args.path], bundle: true, write: false, minify: true, conditions: ['production'], external: ['/notara/*'], loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
        return { contents: css.outputFiles[0].text, loader: 'text' };
      });
    } }],
  });
  if (result.outputFiles.length !== 1) throw new Error(`${manifest.name}: unshipped build artifacts`);
  const output = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){const module={exports:{}};const exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports.default ?? module.exports;}});\n`;
  await mkdir(resolve(directory, 'dist'), { recursive: true });
  // The live host watches this artifact. Never expose a truncated bundle to it.
  const target=resolve(directory,'dist/client.js'), temporary=resolve(directory,`dist/.client-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary,output);
  await rename(temporary,target);
  await writeNotices(directory, Object.keys(result.metafile.inputs));
  console.log(`${manifest.name}: ${Buffer.byteLength(output)} bytes`);
}
