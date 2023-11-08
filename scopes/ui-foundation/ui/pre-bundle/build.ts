import webpack from 'webpack';
import { join, resolve } from 'path';
import { existsSync, pathExistsSync } from 'fs-extra';
import { promisify } from 'util';
import chalk from 'chalk';
import { CacheMain } from '@teambit/cache';
import { Logger } from '@teambit/logger';

import { UIRoot } from '../ui-root';
import { clearConsole, createBundleHash, readBundleHash } from './util';
import { UnknownBuildError } from '../exceptions';

export type PreBundleConfig = {
  runtime: string;
  aspectId: string;
  bundleDir: string;
  aspectDir: string;
};

export type PreBundleContext = {
  config: PreBundleConfig;
  uiRoot: UIRoot;
  cache: CacheMain;
  logger: Logger;
  forceRebuild?: boolean;
  shouldSkipBuild: boolean;
  publicDir: string;
  init: (context: PreBundleContext) => Promise<void>;
  getWebpackConfig: (name: string, outputPath: string, publicDir: string) => Promise<webpack.Configuration[]>;
};

async function getShouldSkipBuild({
  config,
  uiRoot,
  forceRebuild,
  publicDir,
  shouldSkipBuild,
}: PreBundleContext): Promise<boolean> {
  if (!shouldSkipBuild) {
    return false;
  }

  const currentBundleUiHash = await createBundleHash(uiRoot, config.runtime);
  const cachedBundleUiHash = readBundleHash(config.aspectId, config.bundleDir, config.aspectDir);
  const isLocalBuildAvailable = existsSync(join(uiRoot.path, publicDir));

  return currentBundleUiHash === cachedBundleUiHash && !isLocalBuildAvailable && !forceRebuild;
}

// TODO: snigleton mode by name
export async function doBuild(context: PreBundleContext, customOutputPath?: string) {
  const { uiRoot, publicDir, getWebpackConfig } = context;
  const outputPath = customOutputPath || uiRoot.path;

  const webpackConfig = (await getWebpackConfig(uiRoot.name, outputPath, publicDir)) as webpack.Configuration[];

  const compiler = webpack(webpackConfig);
  const compilerRun = promisify(compiler.run.bind(compiler));
  const results = await compilerRun();
  if (!results) throw new UnknownBuildError();
  if (results?.hasErrors()) {
    clearConsole();
    throw new Error(results?.toString());
  }

  return results;
}

async function buildIfChanged(context: PreBundleContext): Promise<boolean> {
  const { config, uiRoot, cache, logger, forceRebuild, shouldSkipBuild, publicDir } = context;

  logger.debug(`buildIfChanged, AspectId ${config.aspectId}`);

  if (shouldSkipBuild) {
    logger.debug(`buildIfChanged, AspectId ${config.aspectId}, returned from ui bundle cache`);
    return false;
  }

  const currentBuildUiHash = await createBundleHash(uiRoot, config.runtime);
  const cachedBuildUiHash = await cache.get(uiRoot.path);
  if (currentBuildUiHash === cachedBuildUiHash && !forceRebuild) {
    logger.debug(`buildIfChanged, AspectId ${config.aspectId}, returned from ui build cache`);
    return false;
  }

  if (!cachedBuildUiHash) {
    logger.console(
      `Building UI assets for '${chalk.cyan(uiRoot.name)}' in target directory: ${chalk.cyan(
        publicDir
      )}. The first time we build the UI it may take a few minutes.`
    );
  } else {
    logger.console(
      `Rebuilding UI assets for '${chalk.cyan(uiRoot.name)} in target directory: ${chalk.cyan(publicDir)}' as ${
        uiRoot.configFile
      } has been changed.`
    );
  }

  await doBuild(context);
  await cache.set(uiRoot.path, currentBuildUiHash);
  return true;
}

async function buildIfNoBundle(context: PreBundleContext): Promise<boolean> {
  const { config, uiRoot, cache, shouldSkipBuild, publicDir } = context;
  if (shouldSkipBuild) return false;
  const outputPath = resolve(uiRoot.path, publicDir);
  if (pathExistsSync(outputPath)) return false;
  const hash = await createBundleHash(uiRoot, config.runtime);
  await doBuild(context);
  await cache.set(uiRoot.path, hash);
  return true;
}

export async function useBuild(context: PreBundleContext): Promise<void> {
  context.logger.debug(`buildUI, uiRootAspectId ${context.config.aspectId}`);
  context.shouldSkipBuild = await getShouldSkipBuild(context);
  await buildIfChanged(context);
  await buildIfNoBundle(context);
}
