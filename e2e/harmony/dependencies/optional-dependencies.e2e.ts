import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import Helper from '../../../src/e2e-helper/e2e-helper';

const ENV_POLICY = {
  peers: [
    {
      name: 'react',
      version: '^18.0.0',
      supportedRange: '^17.0.0 || ^18.0.0',
      optional: true,
    },
  ],
  dev: [],
  runtime: [
    {
      name: 'is-odd',
      version: '3.0.1',
      optional: true,
    },
  ],
};

describe.only('optional dependencies', function () {
  this.timeout(0);
  let helper: Helper;
  let envId;
  before(() => {
    helper = new Helper();
    helper.scopeHelper.setNewLocalAndRemoteScopes();
    envId = `${helper.scopes.remote}/react-based-env`;
    helper.command.create('react', 'button', '-p button --env teambit.react/react');
    helper.fs.prependFile('button/button.tsx', 'import React from "react";import isOdd from "is-odd";\n');
    helper.env.setCustomNewEnv(undefined, undefined, { policy: ENV_POLICY });
    helper.command.setEnv('button', envId);
    helper.command.install();
  });
  after(() => {
    helper.scopeHelper.destroy();
  });

  describe('affect component', () => {
    let depResolverAspectEntry;
    before(() => {
      depResolverAspectEntry = helper.command.showAspectConfig('button', 'teambit.dependencies/dependency-resolver');
    });
    it('should add optional dependency with optional=true to the model', () => {
      const optionalDependencyEntry = depResolverAspectEntry.data.dependencies.find((dep) => dep.id === 'is-odd');
      expect(optionalDependencyEntry.optional).to.eq(true);
    });
    it('should add optional peer dependency with optional=true to the model', () => {
      const optionalPeerDependencyEntry = depResolverAspectEntry.data.dependencies.find((dep) => dep.id === 'react');
      expect(optionalPeerDependencyEntry.optional).to.eq(true);
    });
    it('should add optionalDependencies and peerDependenciesMeta to package.json', () => {
      const pkgJson = fs.readJsonSync(
        path.join(helper.fixtures.scopes.localPath, `node_modules/@${helper.scopes.remote}/button/package.json`)
      );
      expect(pkgJson.optionalDependencies).to.eql({
        'is-odd': '3.0.1',
      });
      expect(pkgJson.peerDependenciesMeta).to.eql({
        react: {
          optional: true,
        },
      });
    });
  });
});
