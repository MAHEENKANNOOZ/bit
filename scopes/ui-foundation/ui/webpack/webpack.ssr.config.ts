import { Configuration } from 'webpack';
import path from 'path';
import { merge } from 'webpack-merge';
import { configBaseFactory } from '@teambit/react.webpack.react-webpack';
import { fallbacks } from '@teambit/webpack';

export default function createWebpackConfig(
  workspaceDir: string,
  entryFiles: string[],
  publicDir: string
): Configuration {
  const baseConfig = configBaseFactory(true);
  const ssrConfig = createSsrConfig(workspaceDir, publicDir, entryFiles);
  // @ts-ignore that's an issue because of different types/webpack version
  const combined = merge(baseConfig, ssrConfig);
  // @ts-ignore that's an issue because of different types/webpack version
  return combined;
}

function createSsrConfig(workspaceDir: string, publicDir: string, entryFiles: string[]) {
  const ssrConfig: Configuration = {
    entry: {
      main: entryFiles,
    },
    target: 'node',
    devtool: 'eval-cheap-module-source-map',

    output: {
      path: path.resolve(workspaceDir, publicDir, 'ssr'),
      publicPath: '/public/ssr/',
      libraryTarget: 'commonjs',
      filename: 'index.js',
      chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    },
    resolve: {
      fallback: {
        module: false,
        path: fallbacks.path,
        dgram: false,
        dns: false,
        fs: false,
        stream: false,
        http2: false,
        net: false,
        tls: false,
        child_process: false,
        process: fallbacks.process,
      },
    },

    // // no optimizations for ssr at this point,
    // // especially no chunks.
    // optimization: { },
  };

  return ssrConfig;
}
