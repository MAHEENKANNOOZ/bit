/* eslint-disable no-console */

/**
 * @fileoverview
 */

import { join } from 'path';
import { BuildContext, BuildTask, BuiltTaskResult, TaskLocation } from '@teambit/builder';
import { Capsule } from '@teambit/isolator';
import { Logger } from '@teambit/logger';
import { UiMain } from '@teambit/ui';
import { generateBundleHash, getBundleArtifactDef, getBundleArtifactDirectory } from './pre-bundle/util';
import {
  BUNDLE_UI_RUNTIME_NAME,
  BUNDLE_UI_TASK_NAME,
  BUNDLE_UI_ID,
  BUNDLE_UIROOT_DIR,
  UIROOT_ASPECT_IDS,
  BUNDLE_UI_DIR,
  buildBundleUI,
} from './bundle-ui';

export class BundleUiTask implements BuildTask {
  aspectId = BUNDLE_UI_ID;
  name = BUNDLE_UI_TASK_NAME;
  location: TaskLocation = 'end';

  constructor(private ui: UiMain, private logger: Logger) {}

  async execute(context: BuildContext): Promise<BuiltTaskResult> {
    const capsule: Capsule | undefined = context.capsuleNetwork.seedersCapsules.find(
      (c) => c.component.id.toStringWithoutVersion() === BUNDLE_UI_ID
    );
    if (!capsule) {
      return { componentsResults: [] };
    }

    const { uiRoot } = this.ui.getUiRootContext();

    try {
      await Promise.all(
        Object.values(UIROOT_ASPECT_IDS).map(async (uiRootAspectId) => {
          const outputPath = join(
            capsule.path,
            getBundleArtifactDirectory(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[uiRootAspectId])
          );
          this.logger.info(`Generating UI bundle at ${outputPath}...`);
          console.log('\n[BundleUiTask.execute]', {
            uiAspectId: BUNDLE_UI_ID, // rootAspect
            uiRootAspectId, // rootExtentionName
            uiRootName: uiRoot.name,
            outputPath,
          });
          await buildBundleUI(this.ui, BUNDLE_UI_ID, outputPath);
          await generateBundleHash(uiRoot, BUNDLE_UI_RUNTIME_NAME, outputPath);
        })
      );
    } catch (error) {
      this.logger.error('Generating UI bundle failed');
      console.error(error);
      throw new Error('Generating UI bundle failed');
    }

    const results = {
      componentsResults: [],
      artifacts: [
        getBundleArtifactDef(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[UIROOT_ASPECT_IDS.SCOPE]),
        getBundleArtifactDef(BUNDLE_UI_DIR, BUNDLE_UIROOT_DIR[UIROOT_ASPECT_IDS.WORKSPACE]),
      ],
    };
    console.log('\n[BundleUiTask.execute] results', results);

    return results;
  }
}
