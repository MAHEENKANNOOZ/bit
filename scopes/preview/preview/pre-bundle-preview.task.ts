/* eslint-disable no-console */

/**
 * @fileoverview
 */

import { join } from 'path';
import { BuildContext, BuildTask, BuiltTaskResult, TaskLocation } from '@teambit/builder';
import { Capsule } from '@teambit/isolator';
import { Logger } from '@teambit/logger';
import { UiMain } from '@teambit/ui';
import { generateBundleHash, getBundleArtifactDef, getBundleArtifactDirectory } from '@teambit/ui/pre-bundle/util';
import {
  PRE_BUNDLE_PREVIEW_DIR,
  PRE_BUNDLE_PREVIEW_ID,
  PRE_BUNDLE_PREVIEW_RUNTIME_NAME,
  PRE_BUNDLE_PREVIEW_TASK_NAME,
  buildPreBundlePreview,
} from './pre-bundle-preview';

export class PreBundlePreviewTask implements BuildTask {
  aspectId = PRE_BUNDLE_PREVIEW_ID;
  name = PRE_BUNDLE_PREVIEW_TASK_NAME;
  location: TaskLocation = 'end';

  constructor(private ui: UiMain, private logger: Logger) {}

  async execute(context: BuildContext): Promise<BuiltTaskResult> {
    const capsule: Capsule | undefined = context.capsuleNetwork.seedersCapsules.find(
      (c) => c.component.id.toStringWithoutVersion() === PRE_BUNDLE_PREVIEW_ID
    );
    if (!capsule) {
      return { componentsResults: [] };
    }

    const { uiRoot } = this.ui.getUiRootContext();

    try {
      const outputPath = join(capsule.path, getBundleArtifactDirectory(PRE_BUNDLE_PREVIEW_DIR, ''));
      this.logger.info(`Generating Preview pre-bundle at ${outputPath}...`);
      console.log('\n[PreBundlePreviewTask.execute]', {
        previewAspectId: PRE_BUNDLE_PREVIEW_ID,
        uiRootName: uiRoot.name,
        outputPath,
      });
      await buildPreBundlePreview(this.ui, outputPath);
      await generateBundleHash(uiRoot, PRE_BUNDLE_PREVIEW_RUNTIME_NAME, outputPath);
    } catch (error) {
      this.logger.error('Generating Preview pre-bundle failed');
      throw new Error('Generating Preview pre-bundle failed');
    }

    const results = {
      componentsResults: [],
      artifacts: [getBundleArtifactDef(PRE_BUNDLE_PREVIEW_DIR, '')],
    };
    console.log('\n[BundleUiTask.execute] results', results);

    return results;
  }
}
