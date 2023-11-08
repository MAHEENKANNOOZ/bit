import { join } from 'path';
import { BuildContext, BuildTask, BuiltTaskResult, TaskLocation } from '@teambit/builder';
import { Capsule } from '@teambit/isolator';
import { Logger } from '@teambit/logger';
import { UiMain } from '@teambit/ui';
import { generateBundleHash, getBundleArtifactDef, getBundleArtifactDirectory } from '@teambit/ui/pre-bundle/util';
import { PreviewAspect } from '@teambit/preview';
import { promisify } from 'util';
import webpack from 'webpack';
import createPreBundleConfig from './webpack/webpack.prebundle.config';
import { getEntryForPreBundlePreview } from './pre-bundle-preview';

export const PRE_BUNDLE_PREVIEW_TASK_NAME = 'PreBundlePreview';
export const PRE_BUNDLE_PREVIEW_DIR = 'preview-pre-bundle';
export const PRE_BUNDLE_PREVIEW_HASH_FILENAME = '.hash';

async function build(uiMain: UiMain, logger: Logger, outputPath: string): Promise<webpack.Stats | undefined> {
  logger.debug(`pre-bundle for preview: start`);
  const ui = uiMain.getUi();
  if (!ui) throw new Error('ui not found');
  const [rootExtensionName, uiRoot] = ui;
  const resolvedAspects = await uiRoot.resolveAspects('preview');
  const mainEntry = getEntryForPreBundlePreview(resolvedAspects, rootExtensionName, 'preview', PreviewAspect.id);
  const config = createPreBundleConfig(outputPath, mainEntry);

  const compiler = webpack(config);
  logger.debug(`pre-bundle for preview: running webpack`);
  const compilerRun = promisify(compiler.run.bind(compiler));
  const results = await compilerRun();

  logger.debug(`pre-bundle for preview: completed webpack`);
  if (!results) throw new Error('unknown error during pre-bundle for preview');
  if (results?.hasErrors()) {
    throw new Error(results?.toString());
  }

  return results;
  // return doBuild(getBundleContext(outputPath))
}

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
