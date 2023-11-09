/* eslint-disable no-console */

import { existsSync } from 'fs';
import { ComponentType } from 'react';
import type { AspectMain } from '@teambit/aspect';
import { AspectDefinition } from '@teambit/aspect-loader';
import { CacheAspect, CacheMain } from '@teambit/cache';
import { CLIAspect, CLIMain, MainRuntime } from '@teambit/cli';
import type { ComponentMain } from '@teambit/component';
import { ComponentAspect } from '@teambit/component';
import { ExpressAspect, ExpressMain } from '@teambit/express';
import type { GraphqlMain } from '@teambit/graphql';
import { GraphqlAspect } from '@teambit/graphql';
import { Slot, SlotRegistry, Harmony } from '@teambit/harmony';
import { Logger, LoggerAspect, LoggerMain } from '@teambit/logger';
import PubsubAspect, { PubsubMain } from '@teambit/pubsub';
import pMapSeries from 'p-map-series';
import { Port } from '@teambit/toolbox.network.get-port';
import { join } from 'path';
import webpack from 'webpack';
import { UiServerStartedEvent } from './events';
import { createRoot } from './create-root';
import { UnknownUI } from './exceptions';
import { StartCmd } from './start.cmd';
import { UIBuildCmd } from './ui-build.cmd';
import { UIRoot } from './ui-root';
import { UIServer } from './ui-server';
import { UIAspect, UIRuntime } from './ui.aspect';
import { StartPlugin, StartPluginOptions } from './start-plugin';
import {
  generateBundleUIEntry,
  getBundleUIContext,
  BUNDLE_UI_DIR,
  BUNDLE_UIROOT_DIR,
  buildBundleUI,
} from './bundle-ui';
import { useBuild } from './pre-bundle/build';
import { createBundleHash, getBundlePath } from './pre-bundle/util';

export type UIDeps = [PubsubMain, CLIMain, GraphqlMain, ExpressMain, ComponentMain, CacheMain, LoggerMain, AspectMain];

export type UIRootRegistry = SlotRegistry<UIRoot>;

export type PreStart = (preStartOpts: PreStartOpts) => Promise<void>;

export type PreStartOpts = { skipCompilation?: boolean };

export type OnStart = () => Promise<undefined | ComponentType<{}>>;

export type StartPluginSlot = SlotRegistry<StartPlugin>;

export type PublicDirOverwrite = (uiRoot: UIRoot) => Promise<string | undefined>;

export type BuildMethodOverwrite = (name: string, uiRoot: UIRoot, rebuild?: boolean) => Promise<string>;

export type PreStartSlot = SlotRegistry<PreStart>;

export type OnStartSlot = SlotRegistry<OnStart>;

export type PublicDirOverwriteSlot = SlotRegistry<PublicDirOverwrite>;

export type BuildMethodOverwriteSlot = SlotRegistry<BuildMethodOverwrite>;

export type UIConfig = {
  /**
   * port for the UI root to use.
   */
  port?: number;

  /**
   * port range for the UI root to use.
   */
  portRange: [number, number];

  /**
   * host for the UI root
   */
  host: string;

  /**
   * directory in workspace to use for public assets.
   * always relative to the workspace root directory.
   */
  publicDir: string;

  /** the url to display when server is listening. Note that bit does not provide proxying to this url */
  publicUrl?: string;
};

export type RuntimeOptions = {
  /**
   * determine whether to initiate on verbose mode.
   */
  verbose?: boolean;

  /**
   * name of the UI root to load.
   */
  uiRootName?: string;
  uiRootAspectIdOrName?: string;

  /**
   * component selector pattern to load.
   */
  pattern?: string;

  /**
   * determine whether to start a dev server (defaults to false).
   */
  dev?: boolean;

  /**
   * port of the config.
   */
  port?: number;

  /**
   * determine whether to rebuild the UI before start.
   */
  rebuild?: boolean;

  /**
   * skip build the UI before start
   */
  skipUiBuild?: boolean;
};

export class UiMain {
  constructor(
    /**
     * Pubsub extension.
     */
    private pubsub: PubsubMain,

    private config: UIConfig,

    /**
     * graphql extension.
     */
    private graphql: GraphqlMain,

    /**
     * slot registry of ui roots.
     */
    private uiRootSlot: UIRootRegistry,

    /**
     * express extension.
     */
    private express: ExpressMain,

    /**
     * pre-start slot
     */
    private preStartSlot: PreStartSlot,

    /**
     * on start slot
     */
    private onStartSlot: OnStartSlot,

    /**
     * Overwrite the public dir Slot
     */
    private publicDirOverwriteSlot: PublicDirOverwriteSlot,

    /**
     * Overwrite the build ui method
     */
    private buildMethodOverwriteSlot: BuildMethodOverwriteSlot,

    /**
     * component extension.
     */
    private componentExtension: ComponentMain,

    /**
     * ui logger instance.
     */
    private cache: CacheMain,

    /**
     * ui logger instance.
     */
    private logger: Logger,

    private harmony: Harmony,

    private startPluginSlot: StartPluginSlot
  ) {}

  // ui root

  getUiRootContext(uiRootAspectIdOrName?: string) {
    this.logger.debug(`build, uiRootAspectIdOrName: "${uiRootAspectIdOrName}"`);
    const maybeUiRoot = this.getUi(uiRootAspectIdOrName);
    if (!maybeUiRoot) throw new UnknownUI(uiRootAspectIdOrName, this.possibleUis());
    const [uiRootAspectId, uiRoot] = maybeUiRoot;
    return {
      uiRootAspectId,
      uiRoot,
      cache: this.cache,
      logger: this.logger,
      harmonyConfig: this.harmony.config.toObject(),
    };
  }

  getUiName(uiRootAspectIdOrName?: string): string | undefined {
    const [, ui] = this.getUi(uiRootAspectIdOrName) || [];
    if (!ui) return undefined;

    return ui.name;
  }

  /**
   * get a UI runtime instance.
   */
  getUi(uiRootAspectIdOrName?: string): [string, UIRoot] | undefined {
    if (uiRootAspectIdOrName) {
      const root = this.uiRootSlot.get(uiRootAspectIdOrName) || this.getUiByName(uiRootAspectIdOrName);
      if (!root) return undefined;
      return [uiRootAspectIdOrName, root];
    }
    const uis = this.uiRootSlot.toArray();
    if (uis.length === 1) return uis[0];
    return uis.find(([, root]) => root.priority);
  }

  private getUiByName(name: string) {
    const roots = this.uiRootSlot.toArray();
    const [, root] =
      roots.find(([, uiRoot]) => {
        return uiRoot.name === name;
      }) || [];

    return root;
  }

  private possibleUis() {
    return this.uiRootSlot.toArray().map(([id]) => id);
  }

  /**
   * register a UI slot.
   */
  registerUiRoot(uiRoot: UIRoot) {
    return this.uiRootSlot.register(uiRoot);
  }

  // public dir

  async publicDir(uiRoot: UIRoot) {
    const overwriteFn = this.getOverwritePublic();
    if (overwriteFn) {
      const hasDir = await overwriteFn(uiRoot);
      if (hasDir) return hasDir;
    }

    if (this.config.publicDir.startsWith('/')) {
      return this.config.publicDir.substring(1);
    }

    return this.config.publicDir;
  }

  private getOverwritePublic() {
    const overwritePublic = this.publicDirOverwriteSlot.toArray();
    if (overwritePublic[0]) {
      const [, fn] = overwritePublic[0];
      return fn;
    }
    return undefined;
  }

  /**
   * overwrite the build ui function
   */
  registerPublicDirOverwrite(fn: PublicDirOverwrite) {
    this.publicDirOverwriteSlot.register(fn);
    return this;
  }

  // port number

  async getPort(port?: number): Promise<number> {
    if (port) return port;
    return this.config.port || this.selectPort();
  }

  private async selectPort() {
    const [from, to] = this.config.portRange;
    const usedPorts = (await this.cache.get<number[]>(`${from}${to}`)) || [];
    const port = await Port.getPort(from, to, usedPorts);
    // this will lock the port for 1 min to avoid race conditions
    await this.cache.set(`${from}${to}`, usedPorts.concat(port), 5000);
    return port;
  }

  // public URL

  get publicUrl() {
    return this.config.publicUrl;
  }

  // start plugins

  async invokePreStart(preStartOpts: PreStartOpts): Promise<void> {
    const onPreStartFuncs = this.preStartSlot.values();
    await pMapSeries(onPreStartFuncs, async (fn) => fn(preStartOpts));
  }

  async invokeOnStart(): Promise<ComponentType[]> {
    const onStartFuncs = this.onStartSlot.values();
    const startPlugins = await pMapSeries(onStartFuncs, async (fn) => fn());
    return startPlugins.filter((plugin) => !!plugin) as ComponentType[];
  }

  /**
   * pre-start events are triggered and *completed* before the webserver started.
   * (the promise is awaited)
   */
  registerPreStart(preStartFn: PreStart) {
    this.preStartSlot.register(preStartFn);
  }

  /**
   * bind to ui server start event.
   */
  registerOnStart(onStartFn: OnStart) {
    this.onStartSlot.register(onStartFn);
    return this;
  }

  private async initiatePlugins(options: StartPluginOptions) {
    const plugins = this.startPluginSlot.values();
    await pMapSeries(plugins, (plugin) => plugin.initiate(options));
    return plugins;
  }

  registerStartPlugin(startPlugin: StartPlugin) {
    this.startPluginSlot.register(startPlugin);
    return this;
  }

  // build UI

  private getOverwriteBuildFn() {
    const buildMethodOverwrite = this.buildMethodOverwriteSlot.toArray();
    if (buildMethodOverwrite[0]) {
      const [, fn] = buildMethodOverwrite[0];
      return fn;
    }
    return undefined;
  }

  /**
   * overwrite the build ui function
   */
  registerBuildUIOverwrite(fn: BuildMethodOverwrite) {
    this.buildMethodOverwriteSlot.register(fn);
    return this;
  }

  // MAIN FLOW: create runtime

  runtimeOptions: RuntimeOptions = {};

  /**
   * create a Bit UI runtime.
   */
  async createRuntime(runtimeOptions: RuntimeOptions) {
    // uiRootName to be deprecated
    this.runtimeOptions = runtimeOptions;
    const { uiRootName, uiRootAspectIdOrName, pattern, dev, port, rebuild, verbose, skipUiBuild } = this.runtimeOptions;
    const { uiRootAspectId, uiRoot, cache, logger, harmonyConfig } = this.getUiRootContext(
      uiRootName || uiRootAspectIdOrName
    );
    const publicDir = await this.publicDir(uiRoot);

    const plugins = await this.initiatePlugins({
      verbose,
      pattern,
    });

    if (this.componentExtension.isHost(uiRootAspectId)) {
      this.componentExtension.setHostPriority(uiRootAspectId);
    }

    // prepare the UI server
    const uiServer = UIServer.create({
      express: this.express,
      graphql: this.graphql,
      uiRoot,
      uiRootExtension: uiRootAspectId,
      ui: this,
      logger,
      publicDir,
      startPlugins: plugins,
    });

    // Adding signal listeners to make sure we immediately close the process on
    // sigint / sigterm (otherwise webpack dev server closing will take time)
    this.addSignalListener();

    if (dev) {
      // start the UI server in dev mode
      await uiServer.dev({ portRange: port || this.config.portRange });
    } else {
      let shouldSkipBuild = false;

      // get bundle UI
      const overwrite = this.getOverwriteBuildFn();
      if (overwrite) {
        // overwrite build
        await overwrite(uiRootAspectId, uiRoot, rebuild);
      } else {
        // get bundle UI context
        const context = await getBundleUIContext(uiRootAspectId, uiRoot, publicDir, cache, logger, harmonyConfig);

        // rebuild flag
        context.forceRebuild = rebuild || !uiRoot.buildOptions?.prebundle;

        // skip build flag
        context.forceSkipBuild = skipUiBuild;
        shouldSkipBuild = !!context.shouldSkipBuild;

        // bundle
        await useBuild(context);
      }

      // get bundle UI root path
      const bundleUiPath = getBundlePath(uiRootAspectId, BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[uiRootAspectId]);
      const bundleUiPublicPath = bundleUiPath ? join(bundleUiPath, publicDir) : undefined;
      const bundleUiRoot =
        shouldSkipBuild && bundleUiPublicPath && existsSync(bundleUiPublicPath || '') ? bundleUiPublicPath : undefined;
      if (bundleUiRoot)
        this.logger.debug(`UI createRuntime of ${uiRootAspectId}, bundle will be served from ${bundleUiRoot}`);

      // start the UI server in prod mode
      await uiServer.start({ portRange: port || this.config.portRange, bundleUiRoot });
    }

    // publish UI server started event
    this.pubsub.pub(UIAspect.id, this.createUiServerStartedEvent(this.config.host, uiServer.port, uiRoot));

    return uiServer;
  }

  private addSignalListener() {
    process.on('SIGTERM', () => {
      process.exit();
    });

    process.on('SIGINT', () => {
      process.exit();
    });
  }

  /**
   * Events
   */
  private createUiServerStartedEvent = (targetHost, targetPort, uiRoot) => {
    return new UiServerStartedEvent(Date.now(), targetHost, targetPort, uiRoot);
  };

  // other public APIs

  isHostAvailable(): boolean {
    return Boolean(this.componentExtension.getHost());
  }

  // TODO: ensure whether it's still in used
  /**
   * create a build of the given UI root.
   */
  async build(uiRootAspectIdOrName?: string, customOutputPath?: string): Promise<webpack.MultiStats | undefined> {
    return buildBundleUI(this, uiRootAspectIdOrName, customOutputPath);
  }

  // TODO: ensure whether it's still in used
  createLink(aspectDefs: AspectDefinition[], rootExtensionName: string) {
    return createRoot(aspectDefs, rootExtensionName);
  }

  // TODO: replace with generateBundleUIEntry()
  /**
   * generate the root file of the UI runtime.
   */
  async generateRoot(
    aspectDefs: AspectDefinition[],
    rootExtensionName: string,
    runtimeName = UIRuntime.name,
    rootAspect = UIAspect.id,
    config?: object,
    path?: string,
    ignoreVersion?: boolean
  ) {
    console.log('\n[UI.generateRoot]', {
      rootExtensionName,
      runtimeName,
      rootAspect,
      config,
      path,
      ignoreVersion,
    });
    return generateBundleUIEntry(
      aspectDefs,
      rootExtensionName,
      runtimeName,
      rootAspect,
      config || this.harmony.config.toObject(),
      path || __dirname,
      ignoreVersion
    );
  }

  // TODO: ensure whether it's still in used
  /**
   * Generate hash for a given root
   * This API is public and used by external users, do not rename this function
   */
  async buildUiHash(uiRoot: UIRoot, runtime = 'ui'): Promise<string> {
    return createBundleHash(uiRoot, runtime);
  }

  static defaultConfig: UIConfig = {
    publicDir: 'public/bit',
    portRange: [3000, 3100],
    host: 'localhost',
  };

  static runtime = MainRuntime;
  static dependencies = [
    PubsubAspect,
    CLIAspect,
    GraphqlAspect,
    ExpressAspect,
    ComponentAspect,
    CacheAspect,
    LoggerAspect,
  ];

  static slots = [
    Slot.withType<UIRoot>(),
    Slot.withType<PreStart>(),
    Slot.withType<OnStart>(),
    Slot.withType<PublicDirOverwriteSlot>(),
    Slot.withType<BuildMethodOverwriteSlot>(),
    Slot.withType<StartPlugin>(),
  ];

  static async provider(
    [pubsub, cli, graphql, express, componentExtension, cache, loggerMain]: UIDeps,
    config,
    [uiRootSlot, preStartSlot, onStartSlot, publicDirOverwriteSlot, buildMethodOverwriteSlot, proxyGetterSlot]: [
      UIRootRegistry,
      PreStartSlot,
      OnStartSlot,
      PublicDirOverwriteSlot,
      BuildMethodOverwriteSlot,
      StartPluginSlot
    ],
    harmony: Harmony
  ) {
    // aspectExtension.registerRuntime(new RuntimeDefinition('ui', []))
    const logger = loggerMain.createLogger(UIAspect.id);

    const ui = new UiMain(
      pubsub,
      config,
      graphql,
      uiRootSlot,
      express,
      preStartSlot,
      onStartSlot,
      publicDirOverwriteSlot,
      buildMethodOverwriteSlot,
      componentExtension,
      cache,
      logger,
      harmony,
      proxyGetterSlot
    );

    cli.register(new StartCmd(ui, logger), new UIBuildCmd(ui));

    return ui;
  }
}

UIAspect.addRuntime(UiMain);
