import * as path from 'path';
import fs from 'fs-extra';
import R from 'ramda';
import semver from 'semver';
import { isSnap } from '@teambit/component-version';
import { ComponentID, ComponentIdList } from '@teambit/component-id';
import { uniq, isEmpty, union, cloneDeep } from 'lodash';
import { IssuesList, IssuesClasses } from '@teambit/component-issues';
import { Dependency } from '..';
import { DEFAULT_DIST_DIRNAME, DEPENDENCIES_FIELDS, MANUALLY_REMOVE_DEPENDENCY } from '../../../../constants';
import Consumer from '../../../../consumer/consumer';
import logger from '../../../../logger/logger';
import { getExt, pathNormalizeToLinux, pathRelativeLinux } from '../../../../utils';
import { PathLinux, PathLinuxRelative, PathOsBased, removeFileExtension } from '../../../../utils/path';
import ComponentMap from '../../../bit-map/component-map';
import Component from '../../../component/consumer-component';
import { RelativePath } from '../dependency';
import { getDependencyTree } from '../files-dependency-builder';
import { FileObject, ImportSpecifier, DependenciesTree } from '../files-dependency-builder/types/dependency-tree-type';
import OverridesDependencies from './overrides-dependencies';
import { ResolvedPackageData, resolvePackageData, resolvePackagePath } from '../../../../utils/packages';
import { DependenciesData } from './dependencies-data';
import { packageToDefinetlyTyped } from './package-to-definetly-typed';
import { ExtensionDataList } from '../../../config';
import PackageJsonFile from '../../../../consumer/component/package-json-file';
import { SourceFile } from '../../sources';
import { DependenciesOverridesData } from '../../../config/component-overrides';
import { DependencyDetector } from '../files-dependency-builder/detector-hook';

export type AllDependencies = {
  dependencies: Dependency[];
  devDependencies: Dependency[];
};

export type AllPackagesDependencies = {
  packageDependencies: Record<string, string>;
  devPackageDependencies: Record<string, string>;
  peerPackageDependencies: Record<string, string>;
};

export type FileType = {
  isTestFile: boolean;
};

export type DebugDependencies = {
  components: DebugComponentsDependency[];
  unidentifiedPackages?: string[];
};

export type DebugComponentsDependency = {
  id: ComponentID;
  importSource?: string;
  dependencyPackageJsonPath?: string;
  dependentPackageJsonPath?: string;
  // can be resolved here or can be any one of the strategies in dependencies-version-resolver
  versionResolvedFrom?: 'DependencyPkgJson' | 'DependentPkgJson' | 'BitMap' | 'Model' | 'MergeConfig' | string;
  version?: string;
  componentIdResolvedFrom?: 'DependencyPkgJson' | 'DependencyPath';
  packageName?: string;
};

type WorkspacePolicyGetter = () => {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export type EnvPolicyForComponent = {
  dependencies: { [name: string]: string };
  devDependencies: { [name: string]: string };
  peerDependencies: { [name: string]: string };
};

type HarmonyEnvPeersPolicyForEnvItselfGetter = (
  componentId: ComponentID,
  files: SourceFile[]
) => Promise<{ [name: string]: string } | undefined>;

type OnComponentAutoDetectOverrides = (
  configuredExtensions: ExtensionDataList,
  componentId: ComponentID,
  files: SourceFile[]
) => Promise<DependenciesOverridesData>;

type OnComponentAutoDetectConfigMerge = (componentId: ComponentID) => DependenciesOverridesData | undefined;

const DepsKeysToAllPackagesDepsKeys = {
  dependencies: 'packageDependencies',
  devDependencies: 'devPackageDependencies',
  peerDependencies: 'peerPackageDependencies',
};

type GetEnvDetectors = (extensions: ExtensionDataList) => Promise<DependencyDetector[] | null>;

export default class DependencyResolver {
  component: Component;
  consumer: Consumer;
  componentId: ComponentID;
  componentMap: ComponentMap;
  componentFromModel: Component;
  consumerPath: PathOsBased;
  tree: DependenciesTree;
  allDependencies: AllDependencies;
  allPackagesDependencies: AllPackagesDependencies;
  /**
   * This will store a copy of the package deps before removal
   * in order to apply auto detected rules that are running after the removal
   */
  originAllPackagesDependencies: AllPackagesDependencies;
  issues: IssuesList;
  coreAspects: string[] = [];
  processedFiles: string[];
  overridesDependencies: OverridesDependencies;
  debugDependenciesData: DebugDependencies;
  autoDetectOverrides: Record<string, any>;
  autoDetectConfigMerge: Record<string, any>;

  static getWorkspacePolicy: WorkspacePolicyGetter;
  static registerWorkspacePolicyGetter(func: WorkspacePolicyGetter) {
    this.getWorkspacePolicy = func;
  }

  static envDetectorsGetter: GetEnvDetectors;
  static registerEnvDetectorGetter(getter: GetEnvDetectors) {
    this.envDetectorsGetter = getter;
  }

  static getOnComponentAutoDetectOverrides: OnComponentAutoDetectOverrides;
  static registerOnComponentAutoDetectOverridesGetter(func: OnComponentAutoDetectOverrides) {
    this.getOnComponentAutoDetectOverrides = func;
  }

  static getOnComponentAutoDetectConfigMerge: OnComponentAutoDetectConfigMerge;
  static registerOnComponentAutoDetectConfigMergeGetter(func: OnComponentAutoDetectConfigMerge) {
    this.getOnComponentAutoDetectConfigMerge = func;
  }

  /**
   * This will get the peers policy provided by the env of the component
   */
  static getHarmonyEnvPeersPolicyForEnvItself: HarmonyEnvPeersPolicyForEnvItselfGetter;
  static registerHarmonyEnvPeersPolicyForEnvItselfGetter(func: HarmonyEnvPeersPolicyForEnvItselfGetter) {
    this.getHarmonyEnvPeersPolicyForEnvItself = func;
  }

  static getDepResolverAspectName: () => string;
  static getCoreAspectsPackagesAndIds: () => Record<string, string>;
  static getDevFiles: (component: Component) => Promise<string[]>;

  constructor(component: Component, consumer: Consumer) {
    this.component = component;
    this.consumer = consumer;
    this.componentId = component.componentId;
    // the consumerComponent is coming from the workspace, so it must have the componentMap prop
    this.componentMap = this.component.componentMap as ComponentMap;
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    this.componentFromModel = this.component.componentFromModel;
    this.consumerPath = this.consumer.getPath();
    this.allDependencies = {
      dependencies: [],
      devDependencies: [],
    };
    this.allPackagesDependencies = {
      packageDependencies: {},
      devPackageDependencies: {},
      peerPackageDependencies: {},
    };
    this.processedFiles = [];
    this.issues = component.issues;
    this.setLegacyInsideHarmonyIssue();
    this.overridesDependencies = new OverridesDependencies(component);
    this.debugDependenciesData = { components: [] };
  }

  private setTree(tree: DependenciesTree) {
    this.tree = tree;
    // console.log(JSON.stringify(tree, null, 4)); // uncomment to easily watch the tree received from bit-javascript
  }

  /**
   * Resolve components and packages dependencies for a component.
   * This method should NOT have any side-effect on the component. the DependenciesLoader class is
   * responsible for saving this data on the component object.
   *
   * The process is as follows:
   * 1) Use the language driver to parse the component files and find for each file its dependencies.
   * 2) The results we get from the driver per file tells us what are the files and packages that depend on our file.
   * and also whether there are missing packages and files.
   * 3) Using the information from the driver, we go over each one of the dependencies files and find its counterpart
   * component. The way how we find it, is by using the bit.map file which has a mapping between the component name and
   * the file paths.
   * 4) If we find a component to the file dependency, we add it to component.dependencies. Otherwise, it's added to
   * component.issues.untrackedDependencies
   * 5) Similarly, when we find the packages dependencies, they are added to component.packageDependencies. Otherwise,
   * they're added to component.issues.missingPackagesDependenciesOnFs
   * 6) In case the driver found a file dependency that is not on the file-system, we add that file to
   * component.issues.missingDependenciesOnFs
   */
  async getDependenciesData(
    cacheResolvedDependencies: Record<string, any>,
    cacheProjectAst: Record<string, any> | undefined
  ): Promise<DependenciesData> {
    const componentDir = path.join(this.consumerPath, this.componentMap.rootDir);
    const { nonTestsFiles, testsFiles } = this.componentMap.getFilesGroupedByBeingTests();
    const allFiles = [...nonTestsFiles, ...testsFiles];
    const envDetectors = await this.getEnvDetectors();
    // find the dependencies (internal files and packages) through automatic dependency resolution
    const dependenciesTree = await getDependencyTree({
      componentDir,
      workspacePath: this.consumerPath,
      filePaths: allFiles,
      bindingPrefix: this.component.bindingPrefix,
      visited: cacheResolvedDependencies,
      cacheProjectAst,
      envDetectors,
    });
    // we have the files dependencies, these files should be components that are registered in bit.map. Otherwise,
    // they are referred as "untracked components" and the user should add them later on in order to tag
    this.setTree(dependenciesTree.tree);
    const devFiles = await DependencyResolver.getDevFiles(this.component);
    await this.populateDependencies(allFiles, devFiles);
    return new DependenciesData(this.allDependencies, this.allPackagesDependencies, this.issues, this.coreAspects, {
      manuallyRemovedDependencies: this.overridesDependencies.manuallyRemovedDependencies,
      manuallyAddedDependencies: this.overridesDependencies.manuallyAddedDependencies,
      missingPackageDependencies: this.overridesDependencies.missingPackageDependencies,
    });
  }

  async getEnvDetectors(): Promise<DependencyDetector[] | null> {
    return DependencyResolver.envDetectorsGetter(this.component.extensions);
  }

  /**
   * Given the tree of file dependencies from the driver, find the components of these files.
   * Each dependency file has a path, use bit.map to search for the component name by that path.
   * If the component is found, add it to "this.allDependencies.dependencies". Otherwise, add it to "this.issues.untrackedDependencies".
   *
   * For the found components, add their sourceRelativePath and destinationRelativePath, they are being used for
   * generating links upon import:
   * sourceRelativePath - location of the link file.
   * destinationRelativePath - destination written inside the link file.
   *
   * When a dependency is found in a regular (implementation) file, it goes to `dependencies`. If
   * it found on a test file, it goes to `devDependencies`.
   * Similarly, when a package is found in a regular file, it goes to `packageDependencies`. When
   * if found in a test file, it goes to `devPackageDependencies`.
   * An exception for the above is when a package is required in a regular or test file but is also
   * mentioned in the `package.json` file as a peerDependency, in that case, the package is added
   * to `peerPackageDependencies` and removed from other places. Unless this package is overridden
   * and marked as ignored in the consumer or component config file.
   */
  private async populateDependencies(files: string[], testsFiles: string[]) {
    await this.loadAutoDetectOverrides();
    await this.loadAutoDetectConfigMerge();
    files.forEach((file) => {
      const fileType: FileType = {
        isTestFile: testsFiles.includes(file),
      };
      this.throwForNonExistFile(file);
      this.processCoreAspects(file);
      this.processMissing(file, fileType);
      this.processErrors(file);
      this.processPackages(file, fileType);
      this.processComponents(file, fileType);
      this.processDepFiles(file, fileType);
      this.processUnidentifiedPackages(file);
    });

    this.cloneAllPackagesDependencies();

    this.removeIgnoredPackagesByOverrides();
    this.removeDevAndEnvDepsIfTheyAlsoRegulars();
    this.applyPeersFromComponentModel();
    this.applyPackageJson();
    this.applyWorkspacePolicy();
    this.makeLegacyAsPeer();
    await this.applyAutoDetectOverridesOnComponent();
    this.manuallyAddDependencies();
    // Doing this here (after manuallyAddDependencies) because usually the env of the env is adding dependencies as peer of the env
    // which will make this not work if it come before
    // example:
    // custom react has peers with react 16.4.0.
    // the custom react uses the "teambit.envs/env" env, which will add react ^17.0.0 to every component that uses it
    // we want to make sure that the custom react is using 16.4.0 not 17.
    await this.applyAutoDetectedPeersFromEnvOnEnvItSelf();

    this.coreAspects = R.uniq(this.coreAspects);
  }

  private async loadAutoDetectOverrides() {
    const autoDetectOverrides = await DependencyResolver.getOnComponentAutoDetectOverrides(
      this.component.extensions,
      this.component.id,
      this.component.files
    );
    this.autoDetectOverrides = autoDetectOverrides;
  }

  private async loadAutoDetectConfigMerge() {
    const autoDetectOverrides = await DependencyResolver.getOnComponentAutoDetectConfigMerge(this.component.id);
    this.autoDetectConfigMerge = autoDetectOverrides || {};
  }

  private cloneAllPackagesDependencies() {
    this.originAllPackagesDependencies = cloneDeep(this.allPackagesDependencies);
  }

  private removeIgnoredPackagesByOverrides() {
    const shouldBeIncluded = (pkgVersion, pkgName) =>
      !this.overridesDependencies.shouldIgnorePackageByType(pkgName, 'dependencies');
    const shouldBeIncludedDev = (pkgVersion, pkgName) =>
      !this.overridesDependencies.shouldIgnorePackageByType(pkgName, 'devDependencies');

    this.allPackagesDependencies.packageDependencies = R.pickBy(
      shouldBeIncluded,
      this.allPackagesDependencies.packageDependencies
    );
    this.allPackagesDependencies.devPackageDependencies = R.pickBy(
      shouldBeIncludedDev,
      this.allPackagesDependencies.devPackageDependencies
    );
  }

  private throwForNonExistFile(file: string) {
    if (!this.tree[file]) {
      throw new Error(
        `DependencyResolver: a file "${file}" was not returned from the driver, its dependencies are unknown`
      );
    }
  }

  // TODO: maybe cache those results??
  private _resolvePackageData(packageName: string): ResolvedPackageData | undefined {
    const rootDir: PathLinux | null | undefined = this.componentMap.rootDir;
    const consumerPath = this.consumer.getPath();
    const basePath = rootDir ? path.join(consumerPath, rootDir) : consumerPath;
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const modulePath = resolvePackagePath(packageName, basePath, consumerPath);
    if (!modulePath) return undefined; // e.g. it's author and wasn't exported yet, so there's no node_modules of that component
    const packageObject = resolvePackageData(basePath, modulePath);
    return packageObject;
  }

  private _getComponentIdToAdd(
    field: string,
    dependency: string
  ): { componentId?: ComponentID; packageName?: string } | undefined {
    if (field === 'peerDependencies') return undefined;
    const packageData = this._resolvePackageData(dependency);
    return { componentId: packageData?.componentId, packageName: packageData?.name };
  }

  getDependenciesToAddManually(
    packageJson: Record<string, any> | null | undefined,
    existingDependencies: AllDependencies
  ): { components: Record<string, any>; packages: Record<string, any> } | undefined {
    const overrides = this.overridesDependencies.getDependenciesToAddManually();
    if (!overrides) return undefined;
    const components = {};
    const packages = {};
    DEPENDENCIES_FIELDS.forEach((depField) => {
      if (!overrides[depField]) return;
      Object.keys(overrides[depField]).forEach((dependency) => {
        const dependencyValue = overrides[depField][dependency];
        const componentData = this._getComponentIdToAdd(depField, dependency);
        if (componentData?.componentId) {
          const dependencyExist = existingDependencies[depField].find((d) =>
            d.id.isEqualWithoutVersion(componentData.componentId)
          );
          if (!dependencyExist) {
            this.overridesDependencies._addManuallyAddedDep(depField, componentData.componentId.toString());
            components[depField] ? components[depField].push(componentData) : (components[depField] = [componentData]);
          }
          return;
        }
        const addedPkg = this.overridesDependencies._manuallyAddPackage(
          depField,
          dependency,
          dependencyValue,
          packageJson
        );
        if (addedPkg) {
          packages[depField] = Object.assign(packages[depField] || {}, addedPkg);
          if (componentData && !componentData.packageName) {
            this.overridesDependencies.missingPackageDependencies.push(dependency);
          }
        }
      });
    });
    return { components, packages };
  }

  private manuallyAddDependencies() {
    const packageJson = this._getPackageJson();
    const dependencies = this.getDependenciesToAddManually(packageJson, this.allDependencies);
    if (!dependencies) return;
    const { components, packages } = dependencies;
    DEPENDENCIES_FIELDS.forEach((depField) => {
      if (components[depField] && components[depField].length) {
        components[depField].forEach((depData) =>
          this.allDependencies[depField].push(new Dependency(depData.componentId, [], depData.packageName))
        );
      }
      if (packages[depField] && !R.isEmpty(packages[depField])) {
        Object.assign(this.allPackagesDependencies[this._pkgFieldMapping(depField)], packages[depField]);
      }
    });
    // The automatic dependency detector considers all found dependencies to be runtime dependencies.
    // But this breaks proper installation of injected subdependencies that are resolved from workspace components.
    if (this.allPackagesDependencies.packageDependencies && packages.peerDependencies) {
      for (const peerName of Object.keys(packages.peerDependencies)) {
        delete this.allPackagesDependencies.packageDependencies[peerName];
      }
    }
    if (this.allPackagesDependencies.packageDependencies && packages.peerPackageDependencies) {
      for (const peerName of Object.keys(packages.peerPackageDependencies)) {
        delete this.allPackagesDependencies.packageDependencies[peerName];
      }
    }
  }

  private getComponentIdByResolvedPackageData(bit: ResolvedPackageData): ComponentID {
    if (!bit.componentId) {
      throw new Error(`resolved Bit component must have componentId prop in the package.json file`);
    }
    return bit.componentId;
  }

  /**
   * this happens when using relative paths between components, which is allowed on Legacy only.
   * on Harmony, during the execution of this function, it recognizes the use of relative-paths, enter
   * it to the "issues", then, later, it shows a warning on bit-status and block tagging.
   */
  private getComponentIdByDepFile(depFile: PathLinux): {
    componentId: ComponentID | undefined;
    depFileRelative: PathLinux;
    destination: string | null | undefined;
  } {
    let depFileRelative: PathLinux = depFile; // dependency file path relative to consumer root
    let destination: string | null | undefined;
    const rootDir = this.componentMap.rootDir;
    // The depFileRelative is relative to rootDir, change it to be relative to current consumer.
    // We can't use path.resolve(rootDir, fileDep) because this might not work when running
    // bit commands not from root, because resolve take by default the process.cwd
    const rootDirFullPath = path.join(this.consumerPath, rootDir);
    const fullDepFile = path.resolve(rootDirFullPath, depFile);
    depFileRelative = pathNormalizeToLinux(path.relative(this.consumerPath, fullDepFile));

    const componentId = this.consumer.bitMap.getComponentIdByPath(depFileRelative);

    return { componentId, depFileRelative, destination };
  }

  private processDepFiles(originFile: PathLinuxRelative, fileType: FileType, nested = false) {
    // We don't just return because different files of the component might import different things from the depFile
    // See more info here: https://github.com/teambit/bit/issues/1796
    if (!this.processedFiles.includes(originFile)) {
      this.processedFiles.push(originFile);
      // We don't want to calculate nested files again after they calculated as direct files
    } else if (nested) {
      return;
    }
    const allDepsFiles = this.tree[originFile].files;
    if (!allDepsFiles || R.isEmpty(allDepsFiles)) return;
    allDepsFiles.forEach((depFile: FileObject) => {
      const isDepFileUntracked = this.processOneDepFile(
        originFile,
        depFile.file,
        depFile.importSpecifiers,
        fileType,
        depFile,
        nested
      );
      // Only continue recursively if the dep file is untracked
      // for tracked deps if they have untracked deps they will be shown under their own components
      if (isDepFileUntracked) {
        // Recursively check for untracked files (to show them all in bit status)
        // for nested files we don't really care about the file types since we won't do all the checking
        const dummyFileType: FileType = {
          isTestFile: false,
        };
        this.processDepFiles(depFile.file, dummyFileType, true);
      }
    });
  }

  // return true if the dep file is untracked
  private processOneDepFile(
    originFile: PathLinuxRelative,
    depFile: string,
    importSpecifiers: ImportSpecifier[] | undefined,
    fileType: FileType,
    depFileObject: FileObject,
    nested = false
  ): boolean {
    const { componentId, depFileRelative, destination } = this.getComponentIdByDepFile(depFile);
    const importSource: string = depFileObject.importSource as string;
    // the file dependency doesn't have any counterpart component. Add it to this.issues.untrackedDependencies
    if (!componentId) {
      this._pushToUntrackDependenciesIssues(originFile, depFileRelative, nested);
      return true;
    }
    // happens when in the same component one file requires another one. In this case, there is
    // noting to do regarding the dependencies
    if (componentId.isEqual(this.componentId, { ignoreVersion: true })) {
      return false;
    }

    const depComponentMap = this.consumer.bitMap.getComponentIfExist(componentId);
    // found a dependency component. Add it to this.allDependencies.dependencies
    const depRootDir = depComponentMap ? depComponentMap.rootDir : undefined;
    const destinationRelativePath =
      destination ||
      (depRootDir && depFileRelative.startsWith(depRootDir)
        ? pathRelativeLinux(depRootDir, depFileRelative)
        : depFileRelative);

    // when there is no rootDir for the current dependency (it happens when it's AUTHORED), keep the original path
    const sourceRelativePath = depRootDir ? depFileRelative : depFile;

    const depsPaths: RelativePath = {
      sourceRelativePath,
      destinationRelativePath,
    };
    if (importSpecifiers) {
      importSpecifiers.forEach((importSpecifier) => {
        if (importSpecifier.mainFile) delete importSpecifier.mainFile.exported;
      });
      depsPaths.importSpecifiers = importSpecifiers;
    }
    const currentComponentsDeps = new Dependency(componentId, [depsPaths]);
    this._pushToRelativeComponentsAuthoredIssues(originFile, componentId, importSource, depsPaths);

    const allDependencies: Dependency[] = [
      ...this.allDependencies.dependencies,
      ...this.allDependencies.devDependencies,
    ];
    const existingDependency = this.getExistingDependency(allDependencies, componentId);
    if (existingDependency) {
      const existingDepRelativePaths = this.getExistingDepRelativePaths(existingDependency, depsPaths);
      if (!existingDepRelativePaths) {
        // it is another file of an already existing component. Just add the new path
        existingDependency.relativePaths.push(depsPaths);
        return false;
      }
      // The dep path already exists but maybe this dep-file has more importSpecifiers
      if (depsPaths.importSpecifiers) {
        // add them to the existing dep
        if (!existingDepRelativePaths.importSpecifiers) {
          existingDepRelativePaths.importSpecifiers = [...depsPaths.importSpecifiers];
        } else {
          // both have importSpecifiers
          const nonExistingImportSpecifiers = this.getDiffSpecifiers(
            existingDepRelativePaths.importSpecifiers,
            depsPaths.importSpecifiers
          );
          existingDepRelativePaths.importSpecifiers.push(...nonExistingImportSpecifiers);
        }
      }

      if (depsPaths.importSource && !existingDepRelativePaths.importSource) {
        existingDepRelativePaths.importSource = depsPaths.importSource;
      }
    } else {
      const depDebug: DebugComponentsDependency = {
        id: currentComponentsDeps.id,
        importSource,
      };
      this.pushToDependenciesArray(currentComponentsDeps, fileType, depDebug);
    }
    return false;
  }

  /**
   * process require/import of Bit components where the require statement is not a relative path
   * but a module path, such as `require('@bit/bit.envs/compiler/babel');`
   */
  private processComponents(originFile: PathLinuxRelative, fileType: FileType) {
    const components = this.tree[originFile].components;
    if (!components || R.isEmpty(components)) return;
    components.forEach((compDep) => {
      let componentId = this.getComponentIdByResolvedPackageData(compDep);
      if (componentId.isEqual(this.componentId)) {
        // the component is importing itself, so ignore it. although currently it doesn't cause any issues, (probably
        // because it filtered out later), it's better to remove it as soon as possible, for less-confusing debugging.
        return;
      }
      const depDebug: DebugComponentsDependency = {
        id: componentId,
        dependencyPackageJsonPath: compDep.packageJsonPath,
        dependentPackageJsonPath: compDep.dependentPackageJsonPath,
        componentIdResolvedFrom: 'DependencyPkgJson',
        packageName: compDep.name,
      };
      const getVersionFromPkgJson = (): string | null => {
        const versionFromDependencyPkgJson = this.getValidVersion(compDep.concreteVersion);
        if (versionFromDependencyPkgJson) {
          depDebug.versionResolvedFrom = 'DependencyPkgJson';
          return versionFromDependencyPkgJson;
        }
        const versionFromDependentPkgJson = this.getValidVersion(compDep.versionUsedByDependent);
        if (versionFromDependentPkgJson) {
          depDebug.versionResolvedFrom = 'DependentPkgJson';
          return versionFromDependentPkgJson;
        }
        return null;
      };
      const version = getVersionFromPkgJson();
      if (version) {
        componentId = componentId.changeVersion(version);
      }
      if (this.overridesDependencies.shouldIgnorePackage(compDep.name, fileType)) {
        return;
      }
      const getExistingIdFromBitmap = (): ComponentID | undefined => {
        const existingIds = this.consumer.bitmapIdsFromCurrentLane.filterWithoutVersion(componentId);
        return existingIds.length === 1 ? existingIds[0] : undefined;
      };
      const getFromMergeConfig = () => {
        let foundVersion: string | undefined | null;
        DEPENDENCIES_FIELDS.forEach((field) => {
          if (this.autoDetectConfigMerge[field]?.[compDep.name]) {
            foundVersion = this.autoDetectConfigMerge[field]?.[compDep.name];
            foundVersion = foundVersion ? this.getValidVersion(foundVersion) : null;
          }
        });
        return foundVersion ? componentId.changeVersion(foundVersion) : undefined;
      };
      const getExistingIdFromModel = (): ComponentID | undefined => {
        if (this.componentFromModel) {
          const modelDep = this.componentFromModel.getAllDependenciesIds().searchWithoutVersion(componentId);
          if (modelDep) {
            depDebug.versionResolvedFrom = 'Model';
            return modelDep;
          }
        }
        return undefined;
      };
      const getExistingId = (): ComponentID => {
        if (this.isPkgInOverrides(compDep.name)) {
          return componentId;
        }

        const fromBitmap = getExistingIdFromBitmap();
        if (fromBitmap) {
          depDebug.versionResolvedFrom = 'BitMap';
          return fromBitmap;
        }

        // In case it's resolved from the node_modules, and it's also in the ws policy or variants,
        // use the resolved version from the node_modules / package folder
        if (this.isPkgInWorkspacePolicies(compDep.name)) {
          return componentId;
        }

        // merge config here is only auto-detected ones. their priority is less then the ws policy
        // otherwise, imagine you merge a lane, you don't like the dependency you got from the other lane, you run
        // bit-install to change it, but it won't do anything.
        const fromMergeConfig = getFromMergeConfig();
        if (fromMergeConfig) {
          depDebug.versionResolvedFrom = 'MergeConfig';
          return fromMergeConfig;
        }

        if (this.isPkgInAutoDetectOverrides(compDep.name)) {
          return componentId;
        }

        // If there is a version in the node_modules/package folder, but it's not in the ws policy,
        // prefer the version from the model over the version from the node_modules
        return getExistingIdFromModel() ?? componentId;
      };
      const existingId = getExistingId();
      if (existingId.isEqualWithoutVersion(this.componentId)) {
        // happens when one of the component files requires another using module path
        // no need to enter anything to the dependencies
        return;
      }
      this.addImportNonMainIssueIfNeeded(originFile, compDep);
      const currentComponentsDeps = new Dependency(existingId, [], compDep.name);
      this._pushToDependenciesIfNotExist(currentComponentsDeps, fileType, depDebug);
    });
  }

  private isPkgInWorkspacePolicies(pkgName: string) {
    return DependencyResolver.getWorkspacePolicy().dependencies?.[pkgName];
  }
  private isPkgInOverrides(pkgName: string): boolean {
    const dependencies = this.overridesDependencies.getDependenciesToAddManually();
    if (!dependencies) return false;
    const allDeps = Object.values(dependencies)
      .map((obj) => Object.keys(obj))
      .flat();
    return allDeps.includes(pkgName);
  }

  private isPkgInAutoDetectOverrides(pkgName: string): boolean {
    return DEPENDENCIES_FIELDS.some(
      (depField) => this.autoDetectOverrides[depField] && this.autoDetectOverrides[depField][pkgName]
    );
  }

  private addImportNonMainIssueIfNeeded(filePath: PathLinuxRelative, dependencyPkgData: ResolvedPackageData) {
    const depMain: PathLinuxRelative | undefined = dependencyPkgData.packageJsonContent?.main;
    if (!depMain) {
      return;
    }
    const depFullPath = pathNormalizeToLinux(dependencyPkgData.fullPath);

    if (depFullPath.endsWith(depMain)) {
      // it requires the main-file. all is good.
      return;
    }
    const extDisallowNonMain = ['.ts', '.tsx', '.js', '.jsx'];
    if (!extDisallowNonMain.includes(path.extname(depFullPath))) {
      // some files such as scss/json are needed to be imported as non-main
      return;
    }
    const pkgRootDir = dependencyPkgData.packageJsonContent?.componentRootFolder;
    if (pkgRootDir && !fs.existsSync(path.join(pkgRootDir, DEFAULT_DIST_DIRNAME))) {
      // the dependency wasn't compiled yet. the issue is probably because depMain points to the dist
      // and depFullPath is in the source.
      return;
    }
    const nonMainFileSplit = depFullPath.split(`node_modules/`);
    const nonMainFileShort = nonMainFileSplit[1] || nonMainFileSplit[0];
    if (nonMainFileShort.includes('eslintrc')) {
      // a temporary workaround for envs that don't expose eslintrc config in their index file.
      // this is needed for a future change of detecting require.resolve syntax
      return;
    }
    (this.issues.getOrCreate(IssuesClasses.ImportNonMainFiles).data[filePath] ||= []).push(nonMainFileShort);
  }

  private getValidVersion(version: string | undefined) {
    if (!version) {
      return null;
    }
    if (semver.valid(version)) {
      // this takes care of pre-releases as well, as they're considered valid semver.
      return version;
    }
    if (semver.validRange(version)) {
      // if this is a range, e.g. ^1.0.0, return a valid version: 1.0.0.
      const coerced = semver.coerce(version);
      if (coerced) {
        return coerced.version;
      }
    }
    if (isSnap(version)) {
      return version;
    }
    // it's probably a relative path to the component
    return null;
  }

  private processPackages(originFile: PathLinuxRelative, fileType: FileType) {
    const packages = this.tree[originFile].packages;
    if (this.componentFromModel) {
      const modelDeps = this.componentFromModel.getAllPackageDependencies();
      // If a package is not in the policies, then we resolve the package from the model.
      for (const pkgName of Object.keys(packages)) {
        if (!this.isPkgInWorkspacePolicies(pkgName) && modelDeps[pkgName]) {
          packages[pkgName] = modelDeps[pkgName];
        }
      }
    }
    const packageNames = Object.keys(packages).concat(this.tree[originFile].missing?.packages ?? []);
    this._addTypesPackagesForTypeScript(packageNames, originFile);
    if (!packages || R.isEmpty(packages)) return;
    if (fileType.isTestFile) {
      Object.assign(this.allPackagesDependencies.devPackageDependencies, packages);
    } else {
      Object.assign(this.allPackagesDependencies.packageDependencies, packages);
    }
  }

  private processMissing(originFile: PathLinuxRelative, fileType: FileType) {
    const missing = this.tree[originFile].missing;
    if (!missing) return;
    const processMissingFiles = () => {
      if (isEmpty(missing.files)) return;
      const missingFiles = missing.files.filter((file) => {
        const hasExtension = Boolean(path.extname(file));
        if (!hasExtension) return true;
        // the missing file has extension, e.g. "index.js". It's possible that this file doesn't exist in the source
        // but will be available in the dists. so if found same filename without the extension, we assume it's fine.
        const rootDirAbs = this.consumer.toAbsolutePath(this.componentMap.rootDir);
        const filePathAbs = path.resolve(rootDirAbs, file);
        const relativeToCompDir = path.relative(rootDirAbs, filePathAbs);
        const relativeToCompDirWithoutExt = removeFileExtension(relativeToCompDir);
        const compFilesWithoutExt = this.componentMap.getAllFilesPaths().map((f) => removeFileExtension(f));
        const existWithDifferentExt = compFilesWithoutExt.some((f) => f === relativeToCompDirWithoutExt);
        return !existWithDifferentExt;
      });
      if (R.isEmpty(missingFiles)) return;
      this._pushToMissingDependenciesOnFs(originFile, missingFiles);
    };
    const processMissingPackages = () => {
      if (isEmpty(missing.packages)) return;
      const missingPackages = missing.packages.filter(
        (pkg) => !this.overridesDependencies.shouldIgnorePackage(pkg, fileType)
      );
      if (!R.isEmpty(missingPackages)) {
        this._pushToMissingPackagesDependenciesIssues(originFile, missingPackages);
      }
    };
    processMissingFiles();
    processMissingPackages();
  }

  private processErrors(originFile: PathLinuxRelative) {
    const error: any = this.tree[originFile].error;
    if (!error) return;
    logger.errorAndAddBreadCrumb(
      'dependency-resolver.processErrors',
      'got an error from the driver while resolving dependencies'
    );
    logger.error('dependency-resolver.processErrors', error);
    if (error.code === 'PARSING_ERROR') {
      const location = error.lineNumber && error.column ? ` (line: ${error.lineNumber}, column: ${error.column})` : '';
      this.issues.getOrCreate(IssuesClasses.ParseErrors).data[originFile] = error.message + location;
    } else this.issues.getOrCreate(IssuesClasses.ResolveErrors).data[originFile] = error.message;
  }

  /**
   * when a user uses core-extensions these core-extensions should not be dependencies.
   * here, we filter them out from all places they could entered as dependencies.
   * an exception is when running this method on bit-core-extensions themselves (dogfooding), in
   * which case we recognizes that the current originFile is a core-extension and avoid filtering.
   */
  private processCoreAspects(originFile: PathLinuxRelative) {
    const coreAspects = DependencyResolver.getCoreAspectsPackagesAndIds?.();
    if (!coreAspects) {
      return;
    }

    // const scopes = coreAspects.map((id) => {
    //   const id = id.split()
    // });

    const coreAspectIds = Object.values(coreAspects);
    if (coreAspectIds.includes(this.component.id.toStringWithoutVersion())) {
      return;
    }

    const coreAspectsPackages = Object.keys(coreAspects);

    const components = this.tree[originFile].components;
    const unidentifiedPackages = this.tree[originFile].unidentifiedPackages;
    const usedCoreAspects: string[] = [];

    const findMatchingCoreAspect = (packageName: string) => {
      return coreAspectsPackages.find((coreAspectName) => packageName === coreAspectName);
    };
    const unidentifiedPackagesFiltered = unidentifiedPackages?.filter((packageName) => {
      const matchingCoreAspectPackageName = findMatchingCoreAspect(packageName);
      if (matchingCoreAspectPackageName) {
        usedCoreAspects.push(coreAspects[matchingCoreAspectPackageName]);
      }
      return !matchingCoreAspectPackageName;
    });
    const bitsFiltered = components?.filter((packageInfo) => {
      const matchingCoreAspectPackageName = findMatchingCoreAspect(packageInfo.name);
      if (matchingCoreAspectPackageName) {
        usedCoreAspects.push(coreAspects[matchingCoreAspectPackageName]);
      }
      return !matchingCoreAspectPackageName;
    });

    this.tree[originFile].unidentifiedPackages = unidentifiedPackagesFiltered;
    this.tree[originFile].components = bitsFiltered;
    this.coreAspects.push(...R.uniq(usedCoreAspects));
  }

  /**
   * ** LEGACY ONLY **
   * This is related to a legacy feature "custom-module-resolution". the code was removed, only the debug is still there, just in case.
   *
   * ** OLD COMMENT **
   * currently the only unidentified packages being process are the ones coming from custom-modules-resolution.
   * assuming the author used custom-resolution, which enable using non-relative import syntax,
   * for example, requiring the file 'src/utils/is-string' from anywhere as require('utils/is-string');
   * now, when the component is imported, the driver recognizes 'utils/is-string' as a package,
   * because it's not relative.
   * the goal here is to use the 'package' the driver found and match it with one of the
   * dependencies from the model. In the example above, we might find in the model, a dependency
   * is-string with importSource of 'utils/is-string'.
   * Once a match is found, copy the relativePaths from the model.
   *
   * keep in mind that this custom-modules-resolution supported on legacy components only.
   * as such, no need to find the packageName to pass to _pushToDependenciesIfNotExist method.
   */
  private processUnidentifiedPackages(originFile: PathLinuxRelative) {
    const unidentifiedPackages = this.tree[originFile].unidentifiedPackages;
    if (!unidentifiedPackages || !unidentifiedPackages.length) return;
    this.debugDependenciesData.unidentifiedPackages = unidentifiedPackages;
  }

  private _pushToDependenciesIfNotExist(
    dependency: Dependency,
    fileType: FileType,
    depDebug: DebugComponentsDependency
  ) {
    const existingDependency = this.getExistingDependency(this.allDependencies.dependencies, dependency.id);
    const existingDevDependency = this.getExistingDependency(this.allDependencies.devDependencies, dependency.id);
    // no need to enter dev dependency to devDependencies if it exists already in dependencies
    if (existingDependency || (existingDevDependency && fileType.isTestFile)) {
      return;
    }
    // at this point, either, it doesn't exist at all and should be entered.
    // or it exists in devDependencies but now it comes from non-dev file, which should be entered
    // as non-dev.
    this.pushToDependenciesArray(dependency, fileType, depDebug);
  }

  private pushToDependenciesArray(
    currentComponentsDeps: Dependency,
    fileType: FileType,
    depDebug: DebugComponentsDependency
  ) {
    if (fileType.isTestFile) {
      this.allDependencies.devDependencies.push(currentComponentsDeps);
    } else {
      this.allDependencies.dependencies.push(currentComponentsDeps);
    }
    this.debugDependenciesData.components.push(depDebug);
  }

  /**
   * Remove the dependencies which appear both in dev and regular deps from the dev
   * Because if a dependency is both dev dependency and regular dependency it should be treated as regular one
   * Apply for both packages and components dependencies
   */
  private removeDevAndEnvDepsIfTheyAlsoRegulars() {
    // remove dev and env packages that are also regular packages
    const getNotRegularPackages = (packages) =>
      R.difference(R.keys(packages), R.keys(this.allPackagesDependencies.packageDependencies));
    this.allPackagesDependencies.devPackageDependencies = R.pick(
      getNotRegularPackages(this.allPackagesDependencies.devPackageDependencies),
      this.allPackagesDependencies.devPackageDependencies
    );
    // remove dev dependencies that are also regular dependencies
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const componentDepsIds = new ComponentIdList(...this.allDependencies.dependencies.map((c) => c.id));
    this.allDependencies.devDependencies = this.allDependencies.devDependencies.filter(
      (d) => !componentDepsIds.has(d.id)
    );
  }

  private getExistingDependency(dependencies: Dependency[], id: ComponentID): Dependency | null | undefined {
    return dependencies.find((d) => d.id.isEqualWithoutVersion(id));
  }

  private getExistingDepRelativePaths(dependency: Dependency, relativePath: RelativePath) {
    if (!dependency.relativePaths || R.isEmpty(dependency.relativePaths)) return null;
    return dependency.relativePaths.find(
      (paths) =>
        paths.sourceRelativePath === relativePath.sourceRelativePath &&
        paths.destinationRelativePath === relativePath.destinationRelativePath
    );
  }

  private getDiffSpecifiers(originSpecifiers: ImportSpecifier[], targetSpecifiers: ImportSpecifier[]) {
    const cmp = (specifier1, specifier2) => specifier1.mainFile.name === specifier2.mainFile.name;
    return R.differenceWith(cmp, targetSpecifiers, originSpecifiers);
  }

  private applyPeersFromComponentModel(): void {
    const getPeerDependencies = (): Record<string, any> => {
      const packageJson = this._getPackageJsonFromComponentModel();
      if (packageJson && packageJson.peerDependencies) return packageJson.peerDependencies;
      return {};
    };
    const projectPeerDependencies = getPeerDependencies();
    const peerPackages = {};
    if (R.isEmpty(projectPeerDependencies)) return;

    // check whether the peer-dependencies was actually require in the code. if so, remove it from
    // the packages/dev-packages and add it as a peer-package.
    // if it was not required in the code, don't add it to the peerPackages
    Object.keys(projectPeerDependencies).forEach((pkg) => {
      if (this.overridesDependencies.shouldIgnorePeerPackage(pkg)) return;
      ['packageDependencies', 'devPackageDependencies'].forEach((field) => {
        if (Object.keys(this.allPackagesDependencies[field]).includes(pkg)) {
          delete this.allPackagesDependencies[field][pkg];
          peerPackages[pkg] = projectPeerDependencies[pkg];
        }
      });
    });
    this.allPackagesDependencies.peerPackageDependencies = peerPackages;
  }

  private applyPackageJson(): void {
    const packageJson = this._getPackageJson();
    if (!packageJson) return;
    const pkgJsonPeer = packageJson.peerDependencies || {};
    const pkgJsonRegularDeps = packageJson.dependencies || {};
    const peerDeps = this.allPackagesDependencies.peerPackageDependencies || {};
    ['packageDependencies', 'devPackageDependencies', 'peerPackageDependencies'].forEach((field) => {
      R.forEachObjIndexed((_pkgVal, pkgName) => {
        const peerVersionFromPkgJson = pkgJsonPeer[pkgName];
        const regularVersionFromPkgJson = pkgJsonRegularDeps[pkgName];
        if (peerVersionFromPkgJson) {
          delete this.allPackagesDependencies[field][pkgName];
          peerDeps[pkgName] = peerVersionFromPkgJson;
        } else if (regularVersionFromPkgJson) {
          delete this.allPackagesDependencies.peerPackageDependencies?.[pkgName];
          this.allPackagesDependencies[field][pkgName] = regularVersionFromPkgJson;
        }
      }, this.allPackagesDependencies[field]);
    });
    this.allPackagesDependencies.peerPackageDependencies = peerDeps;
  }

  private applyWorkspacePolicy(): void {
    const wsPolicy = DependencyResolver.getWorkspacePolicy();
    if (!wsPolicy) return;
    const wsPeer = wsPolicy.peerDependencies || {};
    const wsRegular = wsPolicy.dependencies || {};
    const peerDeps = this.allPackagesDependencies.peerPackageDependencies || {};
    // we are not iterate component deps since they are resolved from what actually installed
    // the policy used for installation only in that case
    ['packageDependencies', 'devPackageDependencies', 'peerPackageDependencies'].forEach((field) => {
      R.forEachObjIndexed((_pkgVal, pkgName) => {
        const peerVersionFromWsPolicy = wsPeer[pkgName];
        const regularVersionFromWsPolicy = wsRegular[pkgName];
        if (peerVersionFromWsPolicy) {
          delete this.allPackagesDependencies[field][pkgName];
          peerDeps[pkgName] = peerVersionFromWsPolicy;
        } else if (regularVersionFromWsPolicy) {
          delete this.allPackagesDependencies.peerPackageDependencies?.[pkgName];
          this.allPackagesDependencies[field][pkgName] = regularVersionFromWsPolicy;
        }
      }, this.allPackagesDependencies[field]);
    });
    this.allPackagesDependencies.peerPackageDependencies = peerDeps;
  }

  /**
   * It removes the @teambit/legacy dependency from the dependencies/devDeps and adds it as a peer dependency with ^.
   */
  private makeLegacyAsPeer(): void {
    let version;
    if (this.allPackagesDependencies.packageDependencies['@teambit/legacy']) {
      version = this.allPackagesDependencies.packageDependencies['@teambit/legacy'];
      delete this.allPackagesDependencies.packageDependencies['@teambit/legacy'];
    }
    if (this.allPackagesDependencies.devPackageDependencies['@teambit/legacy']) {
      if (!version) version = this.allPackagesDependencies.devPackageDependencies['@teambit/legacy'];
      delete this.allPackagesDependencies.devPackageDependencies['@teambit/legacy'];
    }
    if (version) {
      if (!Number.isNaN(version[0])) version = `^${version}`;
      this.allPackagesDependencies.peerPackageDependencies['@teambit/legacy'] = version;
    }
  }

  private async applyAutoDetectOverridesOnComponent(): Promise<void> {
    const autoDetectOverrides = this.autoDetectOverrides;

    if (!autoDetectOverrides || !Object.keys(autoDetectOverrides).length) {
      return;
    }

    const originallyExists: string[] = [];
    let missingPackages: string[] = [];
    // We want to also add missing packages to the peer list as we know to resolve the version from the env anyway
    // @ts-ignore
    const missingData = this.issues.getIssueByName<IssuesClasses.MissingPackagesDependenciesOnFs>(
      'MissingPackagesDependenciesOnFs'
    )?.data;
    if (missingData) {
      // @ts-ignore
      missingPackages = union(...(Object.values(missingData) || []));
    }
    ['dependencies', 'devDependencies', 'peerDependencies'].forEach((field) => {
      R.forEachObjIndexed((pkgVal, pkgName) => {
        if (this.overridesDependencies.shouldIgnorePeerPackage(pkgName)) return;
        // Validate it was auto detected, we only affect stuff that were detected
        const existsInCompsDeps = this.allDependencies.dependencies.find((dep) => {
          return dep.packageName === pkgName;
        });

        const existsInCompsDevDeps = this.allDependencies.devDependencies.find((dep) => {
          return dep.packageName === pkgName;
        });

        if (
          // We are checking originAllPackagesDependencies instead of allPackagesDependencies
          // as it might be already removed from allPackagesDependencies at this point if it was set with
          // "-" in runtime/dev
          // in such case we still want to apply it here
          !this.originAllPackagesDependencies.packageDependencies[pkgName] &&
          !this.originAllPackagesDependencies.devPackageDependencies[pkgName] &&
          !this.originAllPackagesDependencies.peerPackageDependencies[pkgName] &&
          !existsInCompsDeps &&
          !existsInCompsDevDeps &&
          // Check if it was orignally exists in the component
          // as we might have a policy which looks like this:
          // "components": {
          //   "dependencies": {
          //       "my-dep": "-"
          //    },
          //   "devDependencies": {
          //       "my-dep": "1.0.0"
          //    },
          // }
          // in that case we might remove it before getting to the devDeps then we will think that it wasn't required in the component
          // which is incorrect
          !originallyExists.includes(pkgName) &&
          !missingPackages.includes(pkgName)
        ) {
          return;
        }
        originallyExists.push(pkgName);
        const key = DepsKeysToAllPackagesDepsKeys[field];

        delete this.allPackagesDependencies[key][pkgName];
        // When changing peer dependency we want it to be stronger than the other types
        if (field === 'peerDependencies') {
          delete this.allPackagesDependencies.devPackageDependencies[pkgName];
          delete this.allPackagesDependencies.packageDependencies[pkgName];
          if (existsInCompsDeps) {
            this.allDependencies.dependencies = this.allDependencies.dependencies.filter(
              (dep) => dep.packageName !== pkgName
            );
          }
          if (existsInCompsDevDeps) {
            this.allDependencies.devDependencies = this.allDependencies.devDependencies.filter(
              (dep) => dep.packageName !== pkgName
            );
          }
        }
        // delete this.allPackagesDependencies.packageDependencies[pkgName];
        // delete this.allPackagesDependencies.devPackageDependencies[pkgName];
        // delete this.allPackagesDependencies.peerPackageDependencies[pkgName];

        // If it exists in comps deps / comp dev deps, we don't want to add it to the allPackagesDependencies
        // as it will make the same dep both a dev and runtime dep
        // since we are here only for auto detected deps, it means we already resolved the version correctly
        // so we don't need to really modify the version
        // also the version here might have a range (^ or ~ for example) so we can't
        // just put it as is, as it is not valid for component deps to have range
        if (
          pkgVal !== MANUALLY_REMOVE_DEPENDENCY &&
          ((!existsInCompsDeps && !existsInCompsDevDeps) || field === 'peerDependencies')
        ) {
          this.allPackagesDependencies[key][pkgName] = pkgVal;
        }
      }, autoDetectOverrides[field]);
    });
  }

  private async applyAutoDetectedPeersFromEnvOnEnvItSelf(): Promise<void> {
    const envPolicy = await DependencyResolver.getHarmonyEnvPeersPolicyForEnvItself(
      this.component.id,
      this.component.files
    );
    if (!envPolicy || !Object.keys(envPolicy).length) {
      return;
    }
    const deps = this.allPackagesDependencies.packageDependencies || {};
    // we are not iterate component deps since they are resolved from what actually installed
    // the policy used for installation only in that case
    ['packageDependencies', 'devPackageDependencies', 'peerPackageDependencies'].forEach((field) => {
      R.forEachObjIndexed((_pkgVal, pkgName) => {
        const peerVersionFromEnvPolicy = envPolicy[pkgName];
        if (peerVersionFromEnvPolicy) {
          delete this.allPackagesDependencies[field][pkgName];
        }
      }, this.allPackagesDependencies[field]);
    });
    Object.assign(deps, envPolicy);
    // TODO: handle component deps once we support peers between components
    this.allPackagesDependencies.packageDependencies = deps;
  }

  /**
   * returns `package.json` of the component when it's imported, or `package.json` of the workspace
   * when it's authored.
   */
  private _getPackageJson(): Record<string, any> | undefined {
    return this.consumer.packageJson.packageJsonObject;
  }

  private _getPackageJsonFromComponentModel(): Record<string, any> | undefined {
    if (this.componentFromModel && this.component.componentMap) {
      // a component is imported but the package.json file is missing or never written
      // read the values from the model
      const packageJson = PackageJsonFile.createFromComponent(
        this.component.componentMap.rootDir,
        this.componentFromModel
      );
      return packageJson.packageJsonObject;
    }
    return undefined;
  }

  private setLegacyInsideHarmonyIssue() {
    if (this.componentFromModel && this.componentFromModel.isLegacy) {
      this.issues.getOrCreate(IssuesClasses.LegacyInsideHarmony).data = true;
    }
  }

  /**
   * when requiring packages in typescript, sometimes there are the types packages with the same
   * name, which the user probably wants as well. for example, requiring `foo` package, will also
   * add `@types/foo` to the devDependencies if it has been found in the user `package.json` file.
   *
   * ideally this should be in bit-javascript. however, the decision where to put these `@types`
   * packages (dependencies/devDependencies) is done here according to the user `package.json`
   * and can't be done there because the `Tree` we get from bit-javascript doesn't have this
   * distinction.
   */
  private _addTypesPackagesForTypeScript(packageNames: string[], originFile: PathLinuxRelative): void {
    if (packageNames.length === 0) return;
    const isTypeScript = getExt(originFile) === 'ts' || getExt(originFile) === 'tsx';
    if (!isTypeScript) return;
    const depsHost = DependencyResolver.getWorkspacePolicy();
    const addFromConfig = (packageName: string): boolean => {
      if (!depsHost) return false;
      return DEPENDENCIES_FIELDS.some((depField) => {
        if (!depsHost[depField]) return false;
        const typesPackage = packageToDefinetlyTyped(packageName);
        if (!depsHost[depField][typesPackage]) return false;
        Object.assign(this.allPackagesDependencies.devPackageDependencies, {
          [typesPackage]: depsHost[depField][typesPackage],
        });
        return true;
      });
    };
    const addFromModel = (packageName: string) => {
      if (!this.componentFromModel) return;
      const typesPackage = packageToDefinetlyTyped(packageName);
      const typedPackageFromModel = this.componentFromModel.devPackageDependencies[typesPackage];
      if (!typedPackageFromModel) return;
      Object.assign(this.allPackagesDependencies.devPackageDependencies, {
        [typesPackage]: typedPackageFromModel,
      });
    };

    packageNames.forEach((packageName) => {
      const added = addFromConfig(packageName);
      if (!added) addFromModel(packageName);
    });
  }

  private _pkgFieldMapping(field: string) {
    switch (field) {
      case 'dependencies':
        return 'packageDependencies';
      case 'devDependencies':
        return 'devPackageDependencies';
      case 'peerDependencies':
        return 'peerPackageDependencies';
      default:
        throw new Error(`${field} is not recognized`);
    }
  }

  private _pushToUntrackDependenciesIssues(originFile: PathLinuxRelative, depFileRelative, nested = false) {
    const findExisting = () => {
      let result;
      R.forEachObjIndexed((currentUntracked) => {
        const found = currentUntracked.untrackedFiles.find((file) => {
          return file.relativePath === depFileRelative;
        });
        if (found) {
          result = found;
        }
      }, this.issues.getIssue(IssuesClasses.UntrackedDependencies)?.data || {});
      return result;
    };
    const existing = findExisting();
    const newUntrackedFile = { relativePath: depFileRelative, existing: false };
    // If it's already found mark them both as existing
    if (existing) {
      newUntrackedFile.existing = true;
      existing.existing = true;
    }
    const untrackIssue = this.issues.getOrCreate(IssuesClasses.UntrackedDependencies);
    const untrackedCurrentFile = untrackIssue?.data[originFile];
    if (untrackedCurrentFile) {
      untrackedCurrentFile.untrackedFiles.push(newUntrackedFile);
    } else {
      untrackIssue.data[originFile] = { nested, untrackedFiles: [newUntrackedFile] };
    }
  }
  private _pushToRelativeComponentsAuthoredIssues(
    originFile,
    componentId: ComponentID,
    importSource: string,
    relativePath: RelativePath
  ) {
    (this.issues.getOrCreate(IssuesClasses.RelativeComponentsAuthored).data[originFile] ||= []).push({
      importSource,
      componentId,
      relativePath,
    });
  }
  private _pushToMissingDependenciesOnFs(originFile: PathLinuxRelative, missingFiles: string[]) {
    (this.issues.getOrCreate(IssuesClasses.MissingDependenciesOnFs).data[originFile] ||= []).push(...missingFiles);
  }
  private _pushToMissingPackagesDependenciesIssues(originFile: PathLinuxRelative, missingPackages: string[]) {
    (this.issues.getOrCreate(IssuesClasses.MissingPackagesDependenciesOnFs).data[originFile] ||= []).push(
      ...uniq(missingPackages)
    );
  }
}
