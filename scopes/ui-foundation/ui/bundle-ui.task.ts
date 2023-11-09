/**
 * @fileoverview
 */

import { join } from 'path';
import { BuildContext, BuildTask, BuiltTaskResult, TaskLocation } from '@teambit/builder';
import { Capsule } from '@teambit/isolator';
import { Logger } from '@teambit/logger';
import { UIAspect, UiMain } from '@teambit/ui';
import { generateBundleHash, getBundleArtifactDef, getBundleArtifactDirectory } from './pre-bundle/util';
import { BUNDLE_UIROOT_DIR, BUNDLE_UI_DIR, BUNDLE_UI_TASK_NAME, UIROOT_ASPECT_IDS, buildBundleUI } from './bundle-ui';

export class BundleUiTask implements BuildTask {
  aspectId = 'teambit.ui-foundation/ui';
  name = BUNDLE_UI_TASK_NAME;
  location: TaskLocation = 'end';

  constructor(private ui: UiMain, private logger: Logger) {}

  async execute(context: BuildContext): Promise<BuiltTaskResult> {
    const capsule: Capsule | undefined = context.capsuleNetwork.seedersCapsules.find(
      (c) => c.component.id.toStringWithoutVersion() === UIAspect.id
    );
    if (!capsule) {
      return { componentsResults: [] };
    }

    const maybeUiRoot = this.ui.getUi();
    if (!maybeUiRoot) throw new Error('no uiRoot found');
    const [, uiRoot] = maybeUiRoot;

    try {
      await Promise.all(
        Object.values(UIROOT_ASPECT_IDS).map(async (uiRootAspectId) => {
          const outputPath = join(
            capsule.path,
            getBundleArtifactDirectory(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[uiRootAspectId])
          );
          this.logger.info(`Generating UI bundle at ${outputPath}...`);
          await buildBundleUI(this.ui, uiRootAspectId, outputPath);
          await generateBundleHash(uiRoot, 'ui', outputPath);
        })
      );
    } catch (error) {
      this.logger.error('Generating UI bundle failed');
      throw new Error('Generating UI bundle failed');
    }

    return {
      componentsResults: [],
      artifacts: [
        getBundleArtifactDef(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[UIROOT_ASPECT_IDS.SCOPE]),
        getBundleArtifactDef(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[UIROOT_ASPECT_IDS.WORKSPACE]),
      ],
    };
  }
}
