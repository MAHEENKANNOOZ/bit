import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, outputFileSync } from 'fs-extra';
import { UIRoot } from '@teambit/ui';
import { AspectDefinition, getAspectDirFromBvm } from '@teambit/aspect-loader';
import { SlotRegistry } from '@teambit/harmony';
import { ArtifactDefinition } from '@teambit/builder';
import { sha1 } from '@teambit/legacy/dist/utils';
import { createRoot } from '../create-root';

export type UIRootRegistry = SlotRegistry<UIRoot>;

// bundle hash

export const BUNDLE_HASH_FILENAME = '.hash';

export function readBundleHash(aspectId: string, bundleDir: string, aspectDir: string) {
  const bundleUiPathFromBvm = getBundlePath(aspectId, bundleDir, aspectDir);
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

// bundle entry

export async function generateBundleEntry(
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

export function getBundlePath(aspectId: string, bundleDir: string, aspectDir: string): string | undefined {
  try {
    const dirFromBvms = getAspectDirFromBvm(aspectId);
    return join(dirFromBvms, getBundleArtifactDirectory(bundleDir, aspectDir));
  } catch (err) {
    // TODO: logger -> move external
    // this.logger.error(`getBundlePath, getAspectDirFromBvm failed with err: ${err}`);
    return undefined;
  }
}

// // get ui

// export function getUiByName(
//   uiRootSlot: UIRootRegistry,
//   name: string
// ) {
//   const roots = uiRootSlot.toArray();
//   const [, root] =
//     roots.find(([, uiRoot]) => {
//       return uiRoot.name === name;
//     }) || [];
//   return root;
// }

// export function getUi(
//   uiRootSlot: UIRootRegistry,
//   uiRootAspectIdOrName?: string
// ): [string, UIRoot] | undefined {
//   if (uiRootAspectIdOrName) {
//     const root = uiRootSlot.get(uiRootAspectIdOrName) || getUiByName(uiRootSlot, uiRootAspectIdOrName);
//     if (!root) return undefined;
//     return [uiRootAspectIdOrName, root];
//   }
//   const uis = uiRootSlot.toArray();
//   if (uis.length === 1) return uis[0];
//   return uis.find(([, root]) => root.priority);
// }

// export function getUiName(
//   uiRootSlot: UIRootRegistry,
//   uiRootAspectIdOrName?: string
// ): string | undefined {
//   const [, ui] = getUi(uiRootSlot, uiRootAspectIdOrName) || [];
//   if (!ui) return undefined;
//   return ui.name;
// }

// others

export function clearConsole() {
  process.stdout.write(process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H');
}
