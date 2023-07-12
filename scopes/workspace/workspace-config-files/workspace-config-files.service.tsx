import { Logger } from '@teambit/logger';
import { EnvService, Env, EnvContext, ServiceTransformationMap } from '@teambit/envs';
import { ConfigWriterList } from './config-writer-list';
import { ConfigWriterEntry } from './config-writer-entry';

export type PkgDescriptor = {
  id: string;
  displayName: string;
  config?: string;
};

type PkgTransformationMap = ServiceTransformationMap & {
  workspaceConfig: () => ConfigWriterEntry[];
};

export class WorkspaceConfigFilesService implements EnvService<any> {
  name = 'WorkspaceConfigFiles';
  private alreadyShownWarning = {};

  constructor(private logger: Logger) {}

  transform(env: Env, envContext: EnvContext): PkgTransformationMap | undefined {
    // Old env
    if (!env?.workspaceConfig) {
      this.printWarningIfFirstTime(envContext.envId.toString());
      return undefined;
    }

    return {
      workspaceConfig: () => {
        const configWriterList: ConfigWriterList = env.workspaceConfig();
        if (!configWriterList) return [];
        if (!configWriterList.compute) {
          // This is a core env that doesn't use the ConfigWriterList but create the
          // ConfigWriterEntry directly.
          if (
            Array.isArray(configWriterList) &&
            configWriterList.length > 0 &&
            typeof configWriterList[0].calcConfigFiles === 'function'
          ) {
            return configWriterList;
          }
          return [];
        }
        return configWriterList?.compute(envContext);
      },
    };
  }

  private printWarningIfFirstTime(envId: string) {
    const message = `the ${envId} env does not implement the workspaceConfig API. Please update your base env, or implement the workspaceConfig API.`;
    if (!this.alreadyShownWarning[envId]) {
      this.alreadyShownWarning[envId] = true;
      this.logger.consoleWarning(message);
    }
  }
}
