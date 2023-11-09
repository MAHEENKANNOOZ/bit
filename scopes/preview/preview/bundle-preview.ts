/**
 * @fileoverview
 */

import { join, resolve } from 'path';
import { existsSync, readJsonSync, outputFileSync } from 'fs-extra';
import { sha1 } from '@teambit/legacy/dist/utils';

export async function generateBundlePreviewEntry(name: string, previewPreBundlePath: string, config: object) {
  const manifestPath = join(previewPreBundlePath, 'asset-manifest.json');
  const manifest = readJsonSync(manifestPath);
  const imports = manifest.entrypoints
    .map((entry: string) =>
      entry.endsWith('.js')
        ? `import { run } from '${previewPreBundlePath}/${entry}';`
        : `import '${previewPreBundlePath}/${entry}';`
    )
    .join('\n');
  config['teambit.harmony/bit'] = name;

  const contents = [imports, `run(${JSON.stringify(config, null, 2)});`].join('\n');

  const previewRuntime = resolve(join(__dirname, `preview.entry.${sha1(contents)}.js`));
  if (!existsSync(previewRuntime)) {
    outputFileSync(previewRuntime, contents);
  }
  return previewRuntime;
}
