import { build } from 'esbuild';
import ignorePlugin from 'esbuild-plugin-ignore';
import { join } from 'path';

function bundle(){
  const appFile = `bit.app`;
  // const _outfile = join('/Users/giladshoham/dev/temp/bundle-bit/output', `${appFile}.js`);
  const _outfile = join('/Users/giladshoham/dev/bit/bit/bundle', `${appFile}.js`);
  // const _outfile = join('/Users/giladshoham/dev/temp/bundle-bit/output', `test-app.js`);
  return build({
    define: {
      // 'process.env.JSON_LOGS': 'true',
      'process.env.BIT_LOG': `"debug"`,
      // 'import_meta_url': 'import_meta_url',
      'import_meta.url': 'import_meta_url',
    },
    entryPoints: ['/Users/giladshoham/dev/bit/bit/scopes/harmony/bit/app.ts'],
    // entryPoints: ['/Users/giladshoham/dev/bit/bit/node_modules/@teambit/bit/dist/app.js'],
    // entryPoints: ['/Users/giladshoham/dev/temp/bundle-bit/node_modules/@my-scope/bit-bundle/dist/test-app.js'],
    // entryPoints: ['/Users/giladshoham/dev/temp/bundle-bit/my-scope/bit-bundle/test-app.ts']
    bundle: true,
    logLevel: 'error',
    platform: 'node',
    mainFields: ['main', 'module' ],
    format: 'cjs',
    keepNames: true,
    outfile: _outfile,
    inject: [join(__dirname,'./import-meta-url.js')],

    external: [
      '@babel/preset-react',
      'ink',
      'style-loader',
      'mini-css-extract-plugin',
      '@pmmmwh/react-refresh-webpack-plugin',
      '@teambit/react.babel.bit-react-transformer',
      'source-map-loader',
      'babel-loader',
      'react-refresh/babel',
      'babel-loader',
      '@babel/preset-react',
      '@babel/preset-env',
      'react-refresh/babel',
      '@teambit/mdx.modules.mdx-loader',
      '@swc/core',
      // 'esbuild'
      // 'mime'
    ],
    plugins: [
      // sassPlugin(),
      ignorePlugin([
        // { resourceRegExp: /(.*)\.ui\.runtime\.*/g },
        { resourceRegExp: /\.(s[ac]ss|css)$/ },
        // { resourceRegExp: new RegExp('^@swc/core') },
        { resourceRegExp: new RegExp('^jest-resolve') },
        { resourceRegExp: new RegExp('^@vue/compiler-sfc') },
        { resourceRegExp: new RegExp('^batch') },
        { resourceRegExp: new RegExp('^../build/Release/cpufeatures.node') },
        { resourceRegExp: new RegExp('^pnpapi') },
        // { resourceRegExp: new RegExp('^shelljs') },
        // { resourceRegExp: new RegExp('^react') },
        // { resourceRegExp: new RegExp('^react-router-dom') },
        { resourceRegExp: new RegExp('^esbuild') },
        // { resourceRegExp: new RegExp('^../prelude/bootstrap.js') },
        // { resourceRegExp: new RegExp('^./html.docs.mdx') },
        // { resourceRegExp: new RegExp('^stream-browserify') },
        // { resourceRegExp: new RegExp('^expose-loader') },
        // { resourceRegExp: new RegExp('^querystring-es3') },
        // { resourceRegExp: new RegExp('^assert/') },
        // { resourceRegExp: new RegExp('^buffer/') },
        // { resourceRegExp: new RegExp('^constants-browserify') },
        // { resourceRegExp: new RegExp('^crypto-browserify') },
        // { resourceRegExp: new RegExp('^domain-browser') },
        // { resourceRegExp: new RegExp('^stream-http') },
        // { resourceRegExp: new RegExp('^https-browserify') },
        // { resourceRegExp: new RegExp('^os-browserify/browser') },
        // { resourceRegExp: new RegExp('^path-browserify') },
        // { resourceRegExp: new RegExp('^punycode/') },
        // { resourceRegExp: new RegExp('^process/browser') },
        // { resourceRegExp: new RegExp('^querystring-es3') },
        // { resourceRegExp: new RegExp('^stream-browserify') },
        // { resourceRegExp: new RegExp('^string_decoder/') },
        // { resourceRegExp: new RegExp('^util/') },
        // { resourceRegExp: new RegExp('^timers-browserify') },
        // { resourceRegExp: new RegExp('^tty-browserify') },
        // { resourceRegExp: new RegExp('^url/') },
        // { resourceRegExp: new RegExp('^util/') },
        // { resourceRegExp: new RegExp('^vm-browserify') },
        // { resourceRegExp: new RegExp('^browserify-zlib') },
      ]),
    ],
    loader: { '.png': 'binary', '.node': 'binary' },
  });
}

bundle().then((res) => console.log('done', res));
