import { Component, ComponentFS, Config, InvalidComponent, State, TagMap } from '@teambit/component';
import { ComponentID, ComponentIdList } from '@teambit/component-id';
import mapSeries from 'p-map-series';
import { compact, fromPairs, groupBy, uniq } from 'lodash';
import ConsumerComponent from '@teambit/legacy/dist/consumer/component';
import { MissingBitMapComponent } from '@teambit/legacy/dist/consumer/bit-map/exceptions';
import { getLatestVersionNumber } from '@teambit/legacy/dist/utils';
import { IssuesClasses } from '@teambit/component-issues';
import { ComponentNotFound } from '@teambit/legacy/dist/scope/exceptions';
import { DependencyResolverAspect, DependencyResolverMain } from '@teambit/dependency-resolver';
import { Logger } from '@teambit/logger';
import { EnvsAspect, EnvsMain } from '@teambit/envs';
import { ExtensionDataEntry, ExtensionDataList } from '@teambit/legacy/dist/consumer/config';
import { getMaxSizeForComponents, InMemoryCache } from '@teambit/legacy/dist/cache/in-memory-cache';
import { createInMemoryCache } from '@teambit/legacy/dist/cache/cache-factory';
import ComponentNotFoundInPath from '@teambit/legacy/dist/consumer/component/exceptions/component-not-found-in-path';
import { ComponentLoadOptions as LegacyComponentLoadOptions } from '@teambit/legacy/dist/consumer/component/component-loader';
import { Workspace } from '../workspace';
import { WorkspaceComponent } from './workspace-component';
import { MergeConfigConflict } from '../exceptions/merge-config-conflict';

type GetManyRes = {
  components: Component[];
  invalidComponents: InvalidComponent[];
};

export type ComponentLoadOptions = LegacyComponentLoadOptions & {
  loadExtensions?: boolean;
  executeLoadSlot?: boolean;
  idsToNotLoadAsAspects?: string[];
};

type LoadGroup = { workspaceIds: ComponentID[]; scopeIds: ComponentID[] } & LoadGroupMetadata;
type LoadGroupMetadata = {
  core?: boolean;
  aspects?: boolean;
  seeders?: boolean;
};

type GetAndLoadSlotOpts = ComponentLoadOptions & LoadGroupMetadata;

type ComponentGetOneOptions = {
  resolveIdVersion?: boolean;
};

type WorkspaceScopeIdsMap = {
  scopeIds: Map<string, ComponentID>;
  workspaceIds: Map<string, ComponentID>;
};

export type LoadCompAsAspectsOptions = {
  /**
   * In case the component we are loading is app, whether to load it as app (in a scope aspects capsule)
   */
  loadApps?: boolean;
  /**
   * In case the component we are loading is env, whether to load it as env (in a scope aspects capsule)
   */
  loadEnvs?: boolean;

  /**
   * In case the component we are loading is a regular aspect, whether to load it as aspect (in a scope aspects capsule)
   */
  loadAspects?: boolean;

  idsToNotLoadAsAspects?: string[];

  /**
   * Are this core aspects
   */
  core?: boolean;

  /**
   * Are this aspects seeders of the load many operation
   */
  seeders?: boolean;
};

export class WorkspaceComponentLoader {
  private componentsCache: InMemoryCache<Component>; // cache loaded components
  /**
   * Cache components that loaded from scope (especially for get many for perf improvements)
   */
  private scopeComponentsCache: InMemoryCache<Component>;
  /**
   * Cache extension list for components. used by get many for perf improvements.
   * And to make sure we load extensions first.
   */
  private componentsExtensionsCache: InMemoryCache<{ extensions: ExtensionDataList; errors: Error[] | undefined }>;
  constructor(
    private workspace: Workspace,
    private logger: Logger,
    private dependencyResolver: DependencyResolverMain,
    private envs: EnvsMain
  ) {
    this.componentsCache = createInMemoryCache({ maxSize: getMaxSizeForComponents() });
    this.scopeComponentsCache = createInMemoryCache({ maxSize: getMaxSizeForComponents() });
    this.componentsExtensionsCache = createInMemoryCache({ maxSize: getMaxSizeForComponents() });
  }

  async getMany(ids: Array<ComponentID>, loadOpts?: ComponentLoadOptions, throwOnFailure = true): Promise<GetManyRes> {
    const idsWithoutEmpty = compact(ids);
    const longProcessLogger = this.logger.createLongProcessLogger('loading components', ids.length);
    const loadOptsWithDefaults: ComponentLoadOptions = Object.assign(
      // We don't want to load extension or execute the load slot at this step
      // we will do it later
      // this important for better performance
      { loadExtensions: false, executeLoadSlot: false },
      loadOpts || {}
    );

    const loadOrCached: { idsToLoad: ComponentID[]; fromCache: Component[] } = { idsToLoad: [], fromCache: [] };
    idsWithoutEmpty.forEach((id) => {
      const componentFromCache = this.getFromCache(id, loadOpts);
      if (componentFromCache) {
        loadOrCached.fromCache.push(componentFromCache);
      } else {
        loadOrCached.idsToLoad.push(id);
      }
    }, loadOrCached);

    const { components: loadedComponents, invalidComponents } = await this.getAndLoadSlotOrdered(
      loadOrCached.idsToLoad || [],
      loadOptsWithDefaults,
      throwOnFailure,
      longProcessLogger
    );

    const components = [...loadedComponents, ...loadOrCached.fromCache];

    longProcessLogger.end();
    return { components, invalidComponents };
  }

  private async getAndLoadSlotOrdered(
    ids: ComponentID[],
    loadOpts: ComponentLoadOptions,
    throwOnFailure = true,
    longProcessLogger
  ): Promise<GetManyRes> {
    if (!ids?.length) return { components: [], invalidComponents: [] };

    const workspaceScopeIdsMap: WorkspaceScopeIdsMap = await this.groupAndUpdateIds(ids);

    const groupsToHandle = await this.buildLoadGroups(workspaceScopeIdsMap);
    const groupsRes = compact(
      await mapSeries(groupsToHandle, async (group) => {
        const { scopeIds, workspaceIds, aspects, core, seeders } = group;
        if (!workspaceIds.length && !scopeIds.length) return undefined;
        const res = await this.getAndLoadSlot(
          workspaceIds,
          scopeIds,
          { ...loadOpts, core, seeders, aspects },
          throwOnFailure,
          longProcessLogger
        );
        // We don't want to return components that were not asked originally (we do want to load them)
        if (!group.seeders) return undefined;
        return res;
      })
    );
    const finalRes = groupsRes.reduce(
      (acc, curr) => {
        return {
          components: [...acc.components, ...curr.components],
          invalidComponents: [...acc.invalidComponents, ...curr.invalidComponents],
        };
      },
      { components: [], invalidComponents: [] }
    );
    return finalRes;
  }

  private async buildLoadGroups(workspaceScopeIdsMap: WorkspaceScopeIdsMap): Promise<Array<LoadGroup>> {
    const allIds = [...workspaceScopeIdsMap.workspaceIds.values(), ...workspaceScopeIdsMap.scopeIds.values()];
    const groupedByIsCoreEnvs = groupBy(allIds, (id) => {
      return this.envs.isCoreEnv(id.toStringWithoutVersion());
    });
    await this.populateScopeAndExtensionsCache(groupedByIsCoreEnvs.false || [], workspaceScopeIdsMap);
    const allExtIds: Map<string, ComponentID> = new Map();
    groupedByIsCoreEnvs.false.forEach((id) => {
      const idStr = id.toString();
      const fromCache = this.componentsExtensionsCache.get(idStr);
      if (!fromCache || !fromCache.extensions) {
        return;
      }
      fromCache.extensions.forEach((ext) => {
        if (!allExtIds.has(ext.stringId) && ext.newExtensionId) {
          allExtIds.set(ext.stringId, ext.newExtensionId);
        }
      });
    });
    const allExtCompIds = Array.from(allExtIds.values());
    await this.populateScopeAndExtensionsCache(allExtCompIds || [], workspaceScopeIdsMap);

    const allExtIdsStr = allExtCompIds.map((id) => id.toString());
    const groupedByIsExtOfAnother = groupBy(groupedByIsCoreEnvs.false, (id) => {
      return allExtIdsStr.includes(id.toString());
    });
    const extIdsFromTheList = (groupedByIsExtOfAnother.true || []).map((id) => id.toString());
    const extsNotFromTheList: ComponentID[] = [];
    for (const [, id] of allExtIds.entries()) {
      if (!extIdsFromTheList.includes(id.toString())) {
        extsNotFromTheList.push(id);
      }
    }

    await this.groupAndUpdateIds(extsNotFromTheList, workspaceScopeIdsMap);

    const groupsToHandle = [
      // Always load first core envs
      { ids: groupedByIsCoreEnvs.true || [], core: true, aspects: true },
      { ids: extsNotFromTheList || [], core: false, aspects: true, seeders: false },
      { ids: groupedByIsExtOfAnother.true || [], core: false, aspects: true, seeders: true },
      { ids: groupedByIsExtOfAnother.false || [], core: false, aspects: false, seeders: true },
    ];
    const groupsByWsScope = groupsToHandle.map((group) => {
      const groupedByWsScope = groupBy(group.ids, (id) => {
        return workspaceScopeIdsMap.workspaceIds.has(id.toString());
      });
      return {
        workspaceIds: groupedByWsScope.true || [],
        scopeIds: groupedByWsScope.false || [],
        core: group.core,
        aspects: group.aspects,
        seeders: group.seeders,
      };
    });
    return groupsByWsScope;
  }

  private async getAndLoadSlot(
    workspaceIds: ComponentID[],
    scopeIds: ComponentID[],
    loadOpts: GetAndLoadSlotOpts,
    throwOnFailure = true,
    longProcessLogger
  ): Promise<GetManyRes> {
    const { workspaceComponents, scopeComponents, invalidComponents } = await this.getComponentsWithoutLoadExtensions(
      workspaceIds,
      scopeIds,
      loadOpts,
      throwOnFailure,
      longProcessLogger
    );

    const components = workspaceComponents.concat(scopeComponents);

    const allExtensions: ExtensionDataList[] = components.map((component) => {
      return component.state._consumer.extensions;
    });

    // Ensure we won't load the same extension many times
    // We don't want to ignore version here, as we do want to load different extensions with same id but different versions here
    const mergedExtensions = ExtensionDataList.mergeConfigs(allExtensions, false);
    await this.workspace.loadComponentsExtensions(mergedExtensions);
    const withAspects = await Promise.all(
      components.map((component) => {
        return this.executeLoadSlot(component);
      })
    );
    await this.warnAboutMisconfiguredEnvs(withAspects);
    // It's important to load the workspace components as aspects here
    // otherwise the envs from the workspace won't be loaded at time
    // so we will get wrong dependencies from component who uses envs from the workspace
    await this.loadCompsAsAspects(workspaceComponents, {
      loadApps: true,
      loadEnvs: true,
      loadAspects: true,
      core: loadOpts.core,
      seeders: loadOpts.seeders,
      idsToNotLoadAsAspects: loadOpts.idsToNotLoadAsAspects,
    });

    return { components: withAspects, invalidComponents };
  }

  // TODO: this is similar to scope.main.runtime loadCompAspects func, we should merge them.
  async loadCompsAsAspects(
    components: Component[],
    opts: LoadCompAsAspectsOptions = { loadApps: true, loadEnvs: true, loadAspects: true }
  ): Promise<void> {
    const aspectIds: string[] = [];
    components.forEach((component) => {
      if (opts.idsToNotLoadAsAspects?.includes(component.id.toString())) {
        return;
      }
      const appData = component.state.aspects.get('teambit.harmony/application');
      if (opts.loadApps && appData?.data?.appName) {
        aspectIds.push(component.id.toString());
      }
      const envsData = component.state.aspects.get(EnvsAspect.id);
      if (opts.loadEnvs && (envsData?.data?.services || envsData?.data?.self || envsData?.data?.type === 'env')) {
        aspectIds.push(component.id.toString());
      }
      if (opts.loadAspects && envsData?.data?.type === 'aspect') {
        aspectIds.push(component.id.toString());
      }
    });
    if (!aspectIds.length) return;

    await this.workspace.loadAspects(aspectIds, true, 'self loading aspects', {});
  }

  private async populateScopeAndExtensionsCache(ids: ComponentID[], workspaceScopeIdsMap: WorkspaceScopeIdsMap) {
    return mapSeries(ids, async (id) => {
      const idStr = id.toString();
      let componentFromScope;
      if (!this.scopeComponentsCache.has(idStr)) {
        try {
          componentFromScope = await this.workspace.scope.get(id);
          if (componentFromScope) {
            this.scopeComponentsCache.set(idStr, componentFromScope);
          }
          // This is fine here, as it will be handled later in the process
        } catch (err: any) {
          const wsAspectLoader = this.workspace.getWorkspaceAspectsLoader();
          wsAspectLoader.throwWsJsoncAspectNotFoundError(err);
          this.logger.warn(`populateScopeAndExtensionsCache - failed loading component ${idStr} from scope`, err);
        }
      }
      if (!this.componentsExtensionsCache.has(idStr) && workspaceScopeIdsMap.workspaceIds.has(idStr)) {
        componentFromScope = componentFromScope || this.scopeComponentsCache.get(idStr);
        const { extensions, errors } = await this.workspace.componentExtensions(id, componentFromScope, undefined, {
          loadExtensions: false,
        });
        this.componentsExtensionsCache.set(idStr, { extensions, errors });
      }
    });
  }

  private async warnAboutMisconfiguredEnvs(components: Component[]) {
    const allIds = uniq(components.map((component) => this.envs.getEnvId(component)));
    return Promise.all(allIds.map((envId) => this.workspace.warnAboutMisconfiguredEnv(envId)));
  }

  private async groupAndUpdateIds(
    ids: ComponentID[],
    existingGroups?: WorkspaceScopeIdsMap
  ): Promise<WorkspaceScopeIdsMap> {
    const result: WorkspaceScopeIdsMap = existingGroups || {
      scopeIds: new Map(),
      workspaceIds: new Map(),
    };

    await Promise.all(
      ids.map(async (componentId) => {
        const inWs = await this.isInWsIncludeDeleted(componentId);

        if (!inWs) {
          result.scopeIds.set(componentId.toString(), componentId);
          return undefined;
        }
        const resolvedVersions = this.resolveVersion(componentId);
        result.workspaceIds.set(resolvedVersions.toString(), resolvedVersions);
        return undefined;
      })
    );
    return result;
  }

  private async isInWsIncludeDeleted(componentId: ComponentID): Promise<boolean> {
    const nonDeletedWsIds = await this.workspace.listIds();
    const deletedWsIds = await this.workspace.locallyDeletedIds();
    const allWsIds = nonDeletedWsIds.concat(deletedWsIds);
    const inWs = allWsIds.find((id) => id.isEqual(componentId, { ignoreVersion: !componentId.hasVersion() }));
    return !!inWs;
  }

  private async getComponentsWithoutLoadExtensions(
    workspaceIds: ComponentID[],
    scopeIds: ComponentID[],
    loadOpts: GetAndLoadSlotOpts,
    throwOnFailure = true,
    longProcessLogger
  ) {
    const invalidComponents: InvalidComponent[] = [];
    const errors: { id: ComponentID; err: Error }[] = [];
    const loadOptsWithDefaults: ComponentLoadOptions = Object.assign(
      // We don't want to load extension or execute the load slot at this step
      // we will do it later
      // this important for better performance
      // We don't want to store deps in fs cache, as at this point extnesions are not loaded yet
      // so it might save a wrong deps into the cache
      { loadExtensions: false, executeLoadSlot: false },
      loadOpts || {}
    );

    const idsIndex = {};

    // const legacyIds = workspaceIds.map((id) => {
    workspaceIds.forEach((id) => {
      // idsIndex[id._legacy.toString()] = id;
      idsIndex[id.toString()] = id;
      // return id._legacy;
    });

    const {
      components: legacyComponents,
      invalidComponents: legacyInvalidComponents,
      removedComponents,
    } = await this.workspace.consumer.loadComponents(
      ComponentIdList.fromArray(workspaceIds),
      false,
      loadOptsWithDefaults
    );
    const allLegacyComponents = legacyComponents.concat(removedComponents);
    legacyInvalidComponents.forEach((invalidComponent) => {
      const entry = { id: idsIndex[invalidComponent.id.toString()], err: invalidComponent.error };
      if (ConsumerComponent.isComponentInvalidByErrorType(invalidComponent.error)) {
        if (throwOnFailure) throw invalidComponent.error;
        invalidComponents.push(entry);
      }
      if (
        this.isComponentNotExistsError(invalidComponent.error) ||
        invalidComponent.error instanceof ComponentNotFoundInPath
      ) {
        errors.push(entry);
      }
    });

    const getWithCatch = (id, legacyComponent) => {
      return this.get(id, legacyComponent, undefined, undefined, loadOptsWithDefaults).catch((err) => {
        if (ConsumerComponent.isComponentInvalidByErrorType(err) && !throwOnFailure) {
          invalidComponents.push({
            id,
            err,
          });
          return undefined;
        }
        if (this.isComponentNotExistsError(err) || err instanceof ComponentNotFoundInPath) {
          errors.push({
            id,
            err,
          });
          return undefined;
        }
        throw err;
      });
    };

    // await this.getConsumerComponent(id, loadOpts)

    const componentsP = Promise.all(
      allLegacyComponents.map(async (legacyComponent) => {
        let id = idsIndex[legacyComponent.id.toString()];
        if (!id) {
          const withoutVersion = idsIndex[legacyComponent.id.toStringWithoutVersion()] || legacyComponent.id;
          if (withoutVersion) {
            id = withoutVersion.changeVersion(legacyComponent.id.version);
            idsIndex[legacyComponent.id.toString()] = id;
          }
        }
        longProcessLogger.logProgress(id.toString());
        return getWithCatch(id, legacyComponent);
      })
    );

    errors.forEach((err) => {
      this.logger.console(`failed loading component ${err.id.toString()}, see full error in debug.log file`);
      this.logger.warn(`failed loading component ${err.id.toString()}`, err.err);
    });
    const components: Component[] = compact(await componentsP);

    // Here we need to load many, otherwise we will get wrong overrides dependencies data
    // as when loading the next batch of components (next group) we won't have the envs loaded
    const scopeComponents = await this.workspace.scope.loadMany(scopeIds);
    return {
      workspaceComponents: components,
      scopeComponents,
      invalidComponents,
    };
  }

  async getInvalid(ids: Array<ComponentID>): Promise<InvalidComponent[]> {
    const idsWithoutEmpty = compact(ids);
    const errors: InvalidComponent[] = [];
    const longProcessLogger = this.logger.createLongProcessLogger('loading components', ids.length);
    await mapSeries(idsWithoutEmpty, async (id: ComponentID) => {
      longProcessLogger.logProgress(id.toString());
      try {
        await this.workspace.consumer.loadComponent(id);
      } catch (err: any) {
        if (ConsumerComponent.isComponentInvalidByErrorType(err)) {
          errors.push({
            id,
            err,
          });
          return;
        }
        throw err;
      }
    });
    return errors;
  }

  async get(
    componentId: ComponentID,
    legacyComponent?: ConsumerComponent,
    useCache = true,
    storeInCache = true,
    loadOpts?: ComponentLoadOptions,
    getOpts: ComponentGetOneOptions = { resolveIdVersion: true }
  ): Promise<Component> {
    const loadOptsWithDefaults: ComponentLoadOptions = Object.assign(
      { loadExtensions: true, executeLoadSlot: true },
      loadOpts || {}
    );
    const id = getOpts?.resolveIdVersion ? this.resolveVersion(componentId) : componentId;
    const fromCache = this.getFromCache(componentId, loadOptsWithDefaults);
    if (fromCache && useCache) {
      return fromCache;
    }
    let consumerComponent = legacyComponent;
    const inWs = await this.isInWsIncludeDeleted(componentId);
    if (inWs && !consumerComponent) {
      consumerComponent = await this.getConsumerComponent(id, loadOptsWithDefaults);
    }

    // in case of out-of-sync, the id may changed during the load process
    const updatedId = consumerComponent ? consumerComponent.id : id;
    const component = await this.loadOne(updatedId, consumerComponent, loadOptsWithDefaults);
    if (storeInCache) {
      this.addMultipleEnvsIssueIfNeeded(component); // it's in storeInCache block, otherwise, it wasn't fully loaded
      this.saveInCache(component, loadOptsWithDefaults);
    }
    return component;
  }

  async getIfExist(componentId: ComponentID) {
    try {
      return await this.get(componentId);
    } catch (err: any) {
      if (this.isComponentNotExistsError(err)) {
        return undefined;
      }
      throw err;
    }
  }

  private resolveVersion(componentId: ComponentID): ComponentID {
    const bitIdWithVersion: ComponentID = getLatestVersionNumber(
      this.workspace.consumer.bitmapIdsFromCurrentLaneIncludeRemoved,
      componentId
    );
    const id = bitIdWithVersion.version ? componentId.changeVersion(bitIdWithVersion.version) : componentId;
    return id;
  }

  private addMultipleEnvsIssueIfNeeded(component: Component) {
    const envs = this.envs.getAllEnvsConfiguredOnComponent(component);
    const envIds = uniq(envs.map((env) => env.id));
    if (envIds.length < 2) {
      return;
    }
    component.state.issues.getOrCreate(IssuesClasses.MultipleEnvs).data = envIds;
  }

  clearCache() {
    this.componentsCache.deleteAll();
  }
  clearComponentCache(id: ComponentID) {
    const idStr = id.toString();
    for (const cacheKey of this.componentsCache.keys()) {
      if (cacheKey === idStr || cacheKey.startsWith(`${idStr}:`)) {
        this.componentsCache.delete(cacheKey);
      }
    }
  }

  private async loadOne(id: ComponentID, consumerComponent?: ConsumerComponent, loadOpts?: ComponentLoadOptions) {
    const idStr = id.toString();
    const componentFromScope = this.scopeComponentsCache.has(idStr)
      ? this.scopeComponentsCache.get(idStr)
      : await this.workspace.scope.get(id);
    if (!consumerComponent) {
      if (!componentFromScope) throw new MissingBitMapComponent(id.toString());
      return componentFromScope;
    }
    const extErrorsFromCache = this.componentsExtensionsCache.has(idStr)
      ? this.componentsExtensionsCache.get(idStr)
      : undefined;
    const { extensions, errors } =
      extErrorsFromCache ||
      (await this.workspace.componentExtensions(id, componentFromScope, undefined, {
        loadExtensions: loadOpts?.loadExtensions,
      }));
    if (errors?.some((err) => err instanceof MergeConfigConflict)) {
      consumerComponent.issues.getOrCreate(IssuesClasses.MergeConfigHasConflict).data = true;
    }

    // temporarily mutate consumer component extensions until we remove all direct access from legacy to extensions data
    // TODO: remove this once we remove all direct access from legacy code to extensions data
    consumerComponent.extensions = extensions;

    const state = new State(
      new Config(consumerComponent.mainFile, extensions),
      await this.workspace.createAspectList(extensions),
      ComponentFS.fromVinyls(consumerComponent.files),
      consumerComponent.dependencies,
      consumerComponent
    );
    if (componentFromScope) {
      // Removed by @gilad. do not mutate the component from the scope
      // componentFromScope.state = state;
      // const workspaceComponent = WorkspaceComponent.fromComponent(componentFromScope, this.workspace);
      const workspaceComponent = new WorkspaceComponent(
        componentFromScope.id,
        componentFromScope.head,
        state,
        componentFromScope.tags,
        this.workspace
      );
      if (loadOpts?.executeLoadSlot) {
        return this.executeLoadSlot(workspaceComponent, loadOpts);
      }
      // const updatedComp = await this.executeLoadSlot(workspaceComponent, loadOpts);
      return workspaceComponent;
    }
    const newComponent = this.newComponentFromState(id, state);
    if (!loadOpts?.executeLoadSlot) {
      return newComponent;
    }
    return this.executeLoadSlot(newComponent, loadOpts);
  }

  private saveInCache(component: Component, loadOpts?: ComponentLoadOptions): void {
    const cacheKey = createComponentCacheKey(component.id, loadOpts);
    this.componentsCache.set(cacheKey, component);
  }

  /**
   * make sure that not only the id-str match, but also the legacy-id.
   * this is needed because the ComponentID.toString() is the same whether or not the legacy-id has
   * scope-name, as it includes the defaultScope if the scope is empty.
   * as a result, when out-of-sync is happening and the id is changed to include scope-name in the
   * legacy-id, the component is the cache has the old id.
   */
  private getFromCache(componentId: ComponentID, loadOpts?: ComponentLoadOptions): Component | undefined {
    const bitIdWithVersion: ComponentID = this.resolveVersion(componentId);
    const id = bitIdWithVersion.version ? componentId.changeVersion(bitIdWithVersion.version) : componentId;
    const cacheKey = createComponentCacheKey(id, loadOpts);
    const fromCache = this.componentsCache.get(cacheKey);
    if (fromCache && fromCache.id.isEqual(id)) {
      return fromCache;
    }
    return undefined;
  }

  private async getConsumerComponent(
    id: ComponentID,
    loadOpts: ComponentLoadOptions = {}
  ): Promise<ConsumerComponent | undefined> {
    loadOpts.originatedFromHarmony = true;
    try {
      const { components, removedComponents } = await this.workspace.consumer.loadComponents(
        ComponentIdList.fromArray([id]),
        true,
        loadOpts
      );
      return components?.[0] || removedComponents?.[0];
    } catch (err: any) {
      // don't return undefined for any error. otherwise, if the component is invalid (e.g. main
      // file is missing) it returns the model component later unexpectedly, or if it's new, it
      // shows MissingBitMapComponent error incorrectly.
      if (this.isComponentNotExistsError(err)) {
        this.logger.debug(
          `failed loading component "${id.toString()}" from the workspace due to "${err.name}" error\n${err.message}`
        );
        return undefined;
      }
      throw err;
    }
  }

  private isComponentNotExistsError(err: Error): boolean {
    return err instanceof ComponentNotFound || err instanceof MissingBitMapComponent;
  }

  private async executeLoadSlot(component: Component, loadOpts?: ComponentLoadOptions) {
    if (component.state._consumer.removed) {
      // if it was soft-removed now, the component is not in the FS. loading aspects such as composition ends up with
      // errors as they try to read component files from the filesystem.
      return component;
    }

    // Special load events which runs from the workspace but should run from the correct aspect
    // TODO: remove this once those extensions dependent on workspace
    const envsData = await this.envs.calcDescriptor(component, { skipWarnings: !!this.workspace.inInstallContext });

    // Move to deps resolver main runtime once we switch ws<> deps resolver direction
    const policy = await this.dependencyResolver.mergeVariantPolicies(
      component.config.extensions,
      component.id,
      component.state._consumer.files
    );
    const dependenciesList = await this.dependencyResolver.extractDepsFromLegacy(component, policy);

    const depResolverData = {
      packageName: this.dependencyResolver.calcPackageName(component),
      dependencies: dependenciesList.serialize(),
      policy: policy.serialize(),
    };

    // Make sure we are adding the envs / deps data first because other on load events might depend on it
    await Promise.all([
      this.upsertExtensionData(component, EnvsAspect.id, envsData),
      this.upsertExtensionData(component, DependencyResolverAspect.id, depResolverData),
    ]);

    // We are updating the component state with the envs and deps data here, so in case we have other slots that depend on this data
    // they will be able to get it, as it's very common use case that during on load someone want to access to the component env for example
    const aspectListWithEnvsAndDeps = await this.workspace.createAspectList(component.state.config.extensions);
    component.state.aspects = aspectListWithEnvsAndDeps;

    const entries = this.workspace.onComponentLoadSlot.toArray();
    await mapSeries(entries, async ([extension, onLoad]) => {
      const data = await onLoad(component, loadOpts);
      await this.upsertExtensionData(component, extension, data);
      // Update the aspect list to have changes happened during the on load slot (new data added above)
      component.state.aspects.upsertEntry(await this.workspace.resolveComponentId(extension), data);
    });

    return component;
  }

  private newComponentFromState(id: ComponentID, state: State): Component {
    return new WorkspaceComponent(id, null, state, new TagMap(), this.workspace);
  }

  private async upsertExtensionData(component: Component, extension: string, data: any) {
    if (!data) return;
    const existingExtension = component.state.config.extensions.findExtension(extension);
    if (existingExtension) {
      // Only merge top level of extension data
      Object.assign(existingExtension.data, data);
      return;
    }
    component.state.config.extensions.push(await this.getDataEntry(extension, data));
  }

  private async getDataEntry(extension: string, data: { [key: string]: any }): Promise<ExtensionDataEntry> {
    // TODO: @gilad we need to refactor the extension data entry api.
    return new ExtensionDataEntry(undefined, undefined, extension, undefined, data);
  }
}

function createComponentCacheKey(id: ComponentID, loadOpts?: ComponentLoadOptions): string {
  return `${id.toString()}:${JSON.stringify(sortKeys(loadOpts ?? {}))}`;
}

function sortKeys(obj: Object) {
  return fromPairs(Object.entries(obj).sort(([k1], [k2]) => k1.localeCompare(k2)));
}
