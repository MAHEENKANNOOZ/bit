/* eslint-disable no-console */

/**
 * @fileoverview
 */

import { join, resolve } from 'path';
import fs from 'fs-extra';
import { AspectDefinition } from '@teambit/aspect-loader';
import { CacheMain } from '@teambit/cache';
import { Logger } from '@teambit/logger';
// import { UIRoot, UiMain } from '@teambit/ui';
// import { createImports, getIdSetters, getIdentifiers } from '@teambit/ui/dist/create-root';
import { UIRoot, UiMain, createImports, getIdSetters, getIdentifiers } from '@teambit/ui';
import { PreBundleContext, doBuild } from '@teambit/ui/pre-bundle/build';
import { sha1 } from '@teambit/legacy/dist/utils';
import webpack from 'webpack';
import { PreviewAspect } from './preview.aspect';
import createPreBundleConfig from './webpack/webpack.prebundle.config';

export const PRE_BUNDLE_PREVIEW_RUNTIME_NAME = 'preview';
export const PRE_BUNDLE_PREVIEW_TASK_NAME = 'PreBundlePreview';
export const PRE_BUNDLE_PREVIEW_ID = PreviewAspect.id;
export const PRE_BUNDLE_PREVIEW_DIR = 'pre-bundle-preview';
export const PRE_BUNDLE_PREVIEW_PUBLIC_DIR = 'public/bit-preview';

const ENTRY_CONTENT_TEMPLATE = `__IMPORTS__

export const run = (config, customAspects = []) => {
  const isBrowser = typeof window !== "undefined";
  const windowConfig = isBrowser ? window.harmonyAppConfig : undefined;
  const mergedConfig = { ...config, ...windowConfig };
  __ID_SETTERS__
  function render(...props) {
    return Harmony.load(
      [
        ...customAspects,
        __IDENTIFIERS__,
      ],
      __RUNTIME_NAME__,
      mergedConfig
    ).then((harmony) => {
      return harmony
        .run()
        .then(() => harmony.get(__ROOT_ASPECT__))
        .then((rootExtension) => {
          const ssrSetup = !isBrowser && rootExtension.setupSsr;
          const setup = rootExtension.setup;
          const setupFunc = (ssrSetup || setup || function noop() {}).bind(
            rootExtension
          );

          return Promise.resolve(setupFunc()).then(() => rootExtension);
        })
        .then((rootExtension) => {
          if (isBrowser) {
            return rootExtension.render(
              __ROOT_EXTENSION_NAME__,
              ...props
            );
          } else {
            return rootExtension.renderSsr(
              __ROOT_EXTENSION_NAME__,
              ...props
            );
          }
        })
        .catch((err) => {
          throw err;
        });
    });
  }

  if (isBrowser || __RUNTIME_NAME__ === "main") render();
};
`;

export const generatePreBundlePreviewEntry = (
  aspectDefs: AspectDefinition[],
  rootExtensionName: string,
  runtimeName: string,
  rootAspectId: string,
  dir: string
) => {
  const imports = createImports(aspectDefs);
  const identifiers = getIdentifiers(aspectDefs, 'Aspect');
  const idSetters = getIdSetters(aspectDefs, 'Aspect');
  const contents = ENTRY_CONTENT_TEMPLATE.replace('__IMPORTS__', imports)
    .replace('__IDENTIFIERS__', identifiers.join(', '))
    .replace('__ID_SETTERS__', idSetters.join('\n'))
    .replaceAll('__RUNTIME_NAME__', JSON.stringify(runtimeName))
    .replaceAll('__ROOT_ASPECT__', JSON.stringify(rootAspectId))
    .replaceAll('__ROOT_EXTENSION_NAME__', JSON.stringify(rootExtensionName));
  const entryPath = resolve(join(dir, `pre-bundle-preview-entry.${sha1(contents)}.js`));
  console.log('\n[generatePreBundlePreviewEntry]', {
    rootExtensionName,
    runtimeName,
    rootAspectId,
    dir,
    entryPath,
  });
  if (!fs.existsSync(entryPath)) {
    fs.outputFileSync(entryPath, contents);
  }
  return entryPath;
};

export async function getPreBundlePreviewContext(
  uiRootAspectId: string,
  uiRoot: UIRoot,
  cache: CacheMain,
  logger: Logger
): Promise<PreBundleContext> {
  const context: PreBundleContext = {
    config: {
      runtime: PRE_BUNDLE_PREVIEW_RUNTIME_NAME,
      bundleId: PRE_BUNDLE_PREVIEW_ID,
      aspectId: uiRootAspectId,
      bundleDir: PRE_BUNDLE_PREVIEW_DIR,
      aspectDir: '',
      publicDir: PRE_BUNDLE_PREVIEW_PUBLIC_DIR,
    },
    uiRoot,
    cache,
    logger,
    getWebpackConfig: async (name: string, outputPath: string, localPublicDir: string) => {
      const resolvedAspects = await uiRoot.resolveAspects(PRE_BUNDLE_PREVIEW_RUNTIME_NAME);
      console.log('\n[getPreBundlePreviewContext.getWebpackConfig]', {
        name,
        outputPath,
        localPublicDir,
        uiRootAspectId,
        __dirname,
      });

      const mainEntry = generatePreBundlePreviewEntry(
        resolvedAspects,
        PRE_BUNDLE_PREVIEW_ID,
        PRE_BUNDLE_PREVIEW_RUNTIME_NAME,
        uiRootAspectId,
        __dirname
      );

      const config = createPreBundleConfig(resolve(outputPath, localPublicDir), mainEntry);

      return [config];
    },
  };
  return context;
}

export async function buildPreBundlePreview(
  uiMain: UiMain,
  outputPath: string
): Promise<webpack.MultiStats | undefined> {
  const { uiRoot, uiRootAspectId, logger, cache } = uiMain.getUiRootContext();
  logger.debug(`pre-bundle for preview: start`);
  console.log('\n[buildPreBundlePreview]', {
    uiRootAspectId,
    outputPath,
  });
  const context = await getPreBundlePreviewContext(uiRootAspectId, uiRoot, cache, logger);
  const results = await doBuild(context, outputPath);
  return results;
}
