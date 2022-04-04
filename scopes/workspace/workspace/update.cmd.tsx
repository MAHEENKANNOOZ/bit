import { Command, CommandOptions } from '@teambit/cli';

import { Workspace } from './workspace';

type UpdateCmdOptions = {
  compatibleOnly?: boolean;
  yes?: boolean;
};

export default class UpdateCmd implements Command {
  name = 'update';
  description = 'update dependencies';
  alias = 'up';
  group = 'development';
  shortDescription = '';
  options = [['y', 'yes', 'automatically update all outdated packages'],
    ['', 'compatible-only', ''],
  ] as CommandOptions;

  constructor(
    /**
     * workspace extension.
     */
    private workspace: Workspace
  ) {}

  async report(args: [string[]], options: UpdateCmdOptions) {
    await this.workspace.updateDependencies({
      all: options.yes === true,
      compatibleOnly: options.compatibleOnly ?? false,
    });
    return '';
  }
}
