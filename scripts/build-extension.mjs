import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'extension');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) {
  throw new Error('package.json and manifest.json versions must match before building.');
}

// Keep legacy ZIPs in dist/ intact; rebuild only the unpacked extension.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of ['manifest.json', '_locales', 'locales', 'icons', 'src', 'LICENSE', 'NOTICE', 'PRIVACY.md']) {
  await cp(path.join(root, entry), path.join(output, entry), {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith('.'),
  });
}
// Toolkit's Firefox packaging uses this module as its background entry point.
await writeFile(path.join(output, 'service-worker-loader.js'), "import './src/background.js';\n");
console.log(`Built extension ${manifest.version} in ${output}`);
