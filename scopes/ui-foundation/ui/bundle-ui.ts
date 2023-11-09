/* eslint-disable no-console */

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
import { UIAspect } from './ui.aspect';
import { UiMain } from './ui.main.runtime';

export const BUNDLE_UI_RUNTIME_NAME = 'ui';
export const BUNDLE_UI_TASK_NAME = 'BundleUI';
export const BUNDLE_UI_ID = UIAspect.id;
export const BUNDLE_UI_DIR = 'ui-bundle';
export const UIROOT_ASPECT_IDS = {
  SCOPE: 'teambit.scope/scope',
  WORKSPACE: 'teambit.workspace/workspace',
};
export const BUNDLE_UIROOT_DIR = {
  [UIROOT_ASPECT_IDS.SCOPE]: 'scope',
  [UIROOT_ASPECT_IDS.WORKSPACE]: 'workspace',
};

export async function generateBundleUIEntry(
  aspectDefs: AspectDefinition[],
  rootExtensionName: string,
  runtimeName: string,
  rootAspectId: string,
  rootConfig: object,
  dir: string,
  ignoreVersion?: boolean
) {
  console.log('\n[generateBundleUIEntry]', {
    rootExtensionName,
    runtimeName,
    rootAspectId,
    dir,
  });
  const contents = await createRoot(
    aspectDefs,
    rootExtensionName,
    rootAspectId,
    runtimeName,
    rootConfig,
    ignoreVersion
  );
  const filepath = resolve(join(dir, `${runtimeName}.root.${sha1(contents)}.js`));
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
      runtime: BUNDLE_UI_RUNTIME_NAME,
      bundleId: BUNDLE_UI_ID,
      aspectId: uiRootAspectId,
      bundleDir: BUNDLE_UI_DIR,
      aspectDir: BUNDLE_UIROOT_DIR[uiRootAspectId],
      publicDir,
    },
    cache,
    logger,
    uiRoot,
    getWebpackConfig: async (name: string, outputPath: string, localPublicDir: string) => {
      const resolvedAspects = await uiRoot.resolveAspects(BUNDLE_UI_RUNTIME_NAME);
      console.log('\n[getBundleUIContext.getWebpackConfig]', {
        name,
        outputPath,
        localPublicDir,
        uiRootAspectId,
        uiRootPath: uiRoot.path,
      });
      const entryPath = await generateBundleUIEntry(
        resolvedAspects,
        BUNDLE_UI_ID,
        BUNDLE_UI_RUNTIME_NAME,
        uiRootAspectId,
        harmonyConfig,
        __dirname
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
  uiRootAspectIdOrName: string | undefined,
  customOutputPath?: string
): Promise<webpack.MultiStats | undefined> {
  const { uiRootAspectId, uiRoot, logger, cache, harmonyConfig } = uiMain.getUiRootContext(uiRootAspectIdOrName);
  const publicDir = await uiMain.publicDir(uiRoot);
  console.log('\n[buildBundleUI]', {
    uiRootAspectId,
    uiRootName: uiRoot.name,
    publicDir,
    customOutputPath,
  });
  const context = await getBundleUIContext(uiRootAspectId, uiRoot, publicDir, cache, logger, harmonyConfig);
  context.forceRebuild = true;
  context.forceSkipBuild = false;
  return doBuild(context, customOutputPath);
}
