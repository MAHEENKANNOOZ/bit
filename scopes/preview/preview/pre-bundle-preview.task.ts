import { join } from 'path';
import { BuildContext, BuildTask, BuiltTaskResult, TaskLocation } from '@teambit/builder';
import { Capsule } from '@teambit/isolator';
import { Logger } from '@teambit/logger';
import { UiMain } from '@teambit/ui';
import { generateBundleHash, getBundleArtifactDef, getBundleArtifactDirectory } from '@teambit/ui/pre-bundle/util';
import { PreviewAspect } from '@teambit/preview';
import { build } from './pre-bundle-preview';

export const PRE_BUNDLE_PREVIEW_TASK_NAME = 'PreBundlePreview';
export const PRE_BUNDLE_PREVIEW_DIR = 'preview-pre-bundle';
export const PRE_BUNDLE_PREVIEW_HASH_FILENAME = '.hash';

export class PreBundlePreviewTask implements BuildTask {
  aspectId = 'teambit.preview/preview';
  name = PRE_BUNDLE_PREVIEW_TASK_NAME;
  location: TaskLocation = 'end';

  constructor(private ui: UiMain, private logger: Logger) {}

  async execute(context: BuildContext): Promise<BuiltTaskResult> {
    const capsule: Capsule | undefined = context.capsuleNetwork.seedersCapsules.find(
      (c) => c.component.id.toStringWithoutVersion() === PreviewAspect.id
    );
    if (!capsule) {
      return { componentsResults: [] };
    }

    const maybeUiRoot = this.ui.getUi();
    if (!maybeUiRoot) throw new Error('no uiRoot found');

    const [, uiRoot] = maybeUiRoot;

    try {
      const outputPath = join(capsule.path, getBundleArtifactDirectory(PRE_BUNDLE_PREVIEW_DIR, ''));
      this.logger.info(`Generating Preview pre-bundle at ${outputPath}...`);
      await build(this.ui, this.logger, outputPath);
      await generateBundleHash(uiRoot, 'preview', outputPath);
    } catch (error) {
      this.logger.error('Generating Preview pre-bundle failed');
      throw new Error('Generating Preview pre-bundle failed');
    }

    return {
      componentsResults: [],
      artifacts: [getBundleArtifactDef(PRE_BUNDLE_PREVIEW_DIR, '')],
    };
  }
}
