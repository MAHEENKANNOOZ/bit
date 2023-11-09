/**
 * @fileoverview
 */

import { join, resolve } from 'path';
import { existsSync, outputFileSync } from 'fs-extra';
import { CacheMain } from '@teambit/cache';
import { Logger } from '@teambit/logger';
import { AspectDefinition } from '@teambit/aspect-loader';
import { sha1 } from '@teambit/legacy/dist/utils';
import webpack from 'webpack';

import { createRoot } from './create-root';
import { UIRoot } from './ui-root';
import { PreBundleContext, doBuild } from './pre-bundle/build';
import createWebpackConfig from './webpack/webpack.browser.config';
import createSsrWebpackConfig from './webpack/webpack.ssr.config';
import { UiMain } from './ui.main.runtime';

export const BUNDLE_UI_TASK_NAME = 'BundleUI';
export const BUNDLE_UI_DIR = 'ui-bundle';
export const UIROOT_ASPECT_IDS = {
  SCOPE: 'teambit.scope/scope',
  WORKSPACE: 'teambit.workspace/workspace',
};
export const BUNDLE_UIROOT_DIR = {
  [UIROOT_ASPECT_IDS.SCOPE]: 'scope',
  [UIROOT_ASPECT_IDS.WORKSPACE]: 'workspace',
};
export const BUNDLE_UI_HASH_FILENAME = '.hash';

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

export async function getBundleUIContext(
  uiRootAspectId: string,
  uiRoot: UIRoot,
  publicDir,
  cache: CacheMain,
  logger: Logger,
  harmonyConfig: object
): Promise<PreBundleContext> {
  const ssr = uiRoot.buildOptions?.ssr || false;

  const context: PreBundleContext = {
    config: {
      aspectId: uiRootAspectId,
      runtime: 'ui',
      bundleDir: BUNDLE_UI_DIR,
      aspectDir: BUNDLE_UIROOT_DIR[uiRootAspectId],
      publicDir,
    },
    cache,
    logger,
    uiRoot,
    getWebpackConfig: async (name: string, outputPath: string, localPublicDir: string) => {
      const entryPath = await generateBundleUIEntry(
        await uiRoot.resolveAspects('ui'),
        uiRootAspectId,
        'ui',
        uiRootAspectId,
        harmonyConfig,
        uiRoot.path
      );

      const browserConfig = createWebpackConfig(outputPath, [entryPath], name, localPublicDir);
      const ssrConfig = ssr && createSsrWebpackConfig(outputPath, [entryPath], localPublicDir);

      const config = [browserConfig, ssrConfig].filter((x) => !!x) as webpack.Configuration[];
      return config;
    },
  };

  return context;
}

export async function buildBundleUI(
  uiMain: UiMain,
  uiRootAspectIdOrName?: string,
  customOutputPath?: string
): Promise<webpack.MultiStats | undefined> {
  const { uiRootAspectId, uiRoot, logger, cache, harmonyConfig } = uiMain.getUiRootContext(uiRootAspectIdOrName);
  const publicDir = await uiMain.publicDir(uiRoot);
  const context = await getBundleUIContext(uiRootAspectId, uiRoot, publicDir, cache, logger, harmonyConfig);
  context.forceRebuild = true;
  context.forceSkipBuild = false;
  return doBuild(context, customOutputPath);
}
