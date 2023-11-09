/**
 * @fileoverview
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs-extra';
import { UIRoot } from '@teambit/ui';
import { getAspectDirFromBvm } from '@teambit/aspect-loader';
import { SlotRegistry } from '@teambit/harmony';
import { ArtifactDefinition } from '@teambit/builder';
import { sha1 } from '@teambit/legacy/dist/utils';

export type UIRootRegistry = SlotRegistry<UIRoot>;

// bundle hash

export const BUNDLE_HASH_FILENAME = '.hash';

export function readBundleHash(bundleId: string, bundleDir: string, aspectDir: string) {
  const bundleUiPathFromBvm = getBundlePath(bundleId, bundleDir, aspectDir);
  if (!bundleUiPathFromBvm) {
    return '';
  }
  const hashFilePath = join(bundleUiPathFromBvm, BUNDLE_HASH_FILENAME);
  if (existsSync(hashFilePath)) {
    return readFileSync(hashFilePath).toString();
  }
  return '';
}

export async function createBundleHash(uiRoot: UIRoot, runtime: string): Promise<string> {
  const aspects = await uiRoot.resolveAspects(runtime);
  aspects.sort((a, b) => ((a.getId || a.aspectPath) > (b.getId || b.aspectPath) ? 1 : -1));
  const aspectPathStrings = aspects.map((aspect) => {
    return [aspect.aspectPath, aspect.runtimePath].join('');
  });
  return sha1(aspectPathStrings.join(''));
}

export async function generateBundleHash(uiRoot: UIRoot, runtime: string, outputPath: string): Promise<void> {
  const hash = await createBundleHash(uiRoot, runtime);
  if (!existsSync(outputPath)) mkdirSync(outputPath);
  writeFileSync(join(outputPath, BUNDLE_HASH_FILENAME), hash);
}

// bundle artifact

export function getBundleArtifactDirectory(bundleDir: string, aspectDir: string) {
  return join('artifacts', bundleDir, aspectDir);
}

export function getBundleArtifactDef(bundleDir: string, aspectDir: string): ArtifactDefinition {
  const rootDir = getBundleArtifactDirectory(bundleDir, aspectDir);
  return {
    name: `${bundleDir}${aspectDir ? '-' : ''}${aspectDir}`,
    globPatterns: [`${rootDir}/**`],
  };
}

export function getBundlePath(bundleId: string, bundleDir: string, aspectDir: string): string | undefined {
  try {
    const dirFromBvms = getAspectDirFromBvm(bundleId);
    return join(dirFromBvms, getBundleArtifactDirectory(bundleDir, aspectDir));
  } catch (err) {
    // TODO: logger -> move external
    // this.logger.error(`getBundlePath, getAspectDirFromBvm failed with err: ${err}`);
    return undefined;
  }
}

// others

export function clearConsole() {
  process.stdout.write(process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H');
}
