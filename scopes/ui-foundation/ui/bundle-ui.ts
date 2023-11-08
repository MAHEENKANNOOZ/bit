import { join, resolve } from 'path';
import { existsSync, outputFileSync } from 'fs-extra';
import { AspectDefinition } from '@teambit/aspect-loader';
import { sha1 } from '@teambit/legacy/dist/utils';

import { createRoot } from './create-root';

export async function generateBundleUIEntry(
  aspectDefs: AspectDefinition[],
  rootExtensionName: string,
  runtimeName: string,
  rootAspect: string,
  config: object,
  dir: string,
  ignoreVersion?: boolean
) {
  const contents = await createRoot(aspectDefs, rootExtensionName, rootAspect, runtimeName, config, ignoreVersion);
  const filepath = resolve(join(dir, `${runtimeName}.root${sha1(contents)}.js`));
  if (existsSync(filepath)) return filepath;
  outputFileSync(filepath, contents);
  return filepath;
}
