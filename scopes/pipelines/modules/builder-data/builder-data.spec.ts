import { expect } from 'chai';

import { BuilderData } from './builder-data';

const MOCK_BUILDER_STRING =
  '{"pipeline":[{"taskId":"teambit.compilation/compiler","taskName":"TSCompiler","taskDescription":"compile components for artifact dist","errors":[],"startTime":1644513768819,"endTime":1644513769420},{"taskId":"teambit.defender/tester","taskName":"TestComponents","errors":[]},{"taskId":"teambit.preview/preview","taskName":"GeneratePreview","errors":[],"startTime":1644514024176,"endTime":1644514148167},{"taskId":"teambit.pkg/pkg","taskName":"PackComponents","errors":[],"warnings":[],"startTime":1644514525757,"endTime":1644514527602}],"artifacts":[{"name":"dist","generatedBy":"teambit.typescript/typescript","storage":"default","task":{"id":"teambit.compilation/compiler","name":"TSCompiler"},"files":{"paths":[],"vinyls":[],"refs":[{"relativePath":"dist/features-card.composition.d.ts","ref":{"hash":"95ff1ed20376bb25b781e13c8c3cc8f413f3a0cd"}},{"relativePath":"dist/features-card.composition.js","ref":{"hash":"1cdadad2eeb043703f489907ba1f05ec949e154e"}},{"relativePath":"dist/features-card.composition.js.map","ref":{"hash":"744d4a146a449af4e47ad3b08f6664dd7222b2fd"}},{"relativePath":"dist/features-card.d.ts","ref":{"hash":"84de5d5f86eb64c5865499b97ce448677c93f0cc"}},{"relativePath":"dist/features-card.docs.mdx","ref":{"hash":"58d79320f6446bdaa2fe04d6d5da85cf39df8f31"}},{"relativePath":"dist/features-card.js","ref":{"hash":"ac0087e1a601803d02385eb3e974a42a0ef43513"}},{"relativePath":"dist/features-card.js.map","ref":{"hash":"b1c3b53a7d9d3c8336b4e77051a3e1f845f76709"}},{"relativePath":"dist/features-card.module.scss","ref":{"hash":"090b63544fc65ab7d7266b5317793913738c77b7"}},{"relativePath":"dist/features-card.spec.d.ts","ref":{"hash":"b878c11a77128e74c3cf15c93ef2ceddf2aa0b38"}},{"relativePath":"dist/features-card.spec.js","ref":{"hash":"826da712347158e504e41d4f7faadd482c529923"}},{"relativePath":"dist/features-card.spec.js.map","ref":{"hash":"9a7c4364f9f2b17ba2f73f8201197d4de94bedc8"}},{"relativePath":"dist/index.d.ts","ref":{"hash":"241f1eb96212adc1c59872df300c243744e10b57"}},{"relativePath":"dist/index.js","ref":{"hash":"40a05f1ed58e39cd58b4b8a0f4064639e73254ee"}},{"relativePath":"dist/index.js.map","ref":{"hash":"061cab71ed6d8dbecc29886419be897513385235"}}]}},{"name":"preview-component","generatedBy":"teambit.preview/preview","storage":"default","task":{"id":"teambit.preview/preview","name":"GeneratePreview"},"files":{"paths":[],"vinyls":[],"refs":[{"relativePath":"features-card-preview.f856598a.css","ref":{"hash":"09854600de65129dd0672d6168701917d32dde2e"}},{"relativePath":"features-card.b4b78089.css","ref":{"hash":"240bbdbf7c471ce0142360dc383ca029c8a47622"}},{"relativePath":"teambit_community_ui_features_features_card-component.js","ref":{"hash":"6237f3c6d39636c9babb974a6a864c61bf6243b9"}},{"relativePath":"teambit_community_ui_features_features_card-preview.js","ref":{"hash":"edbf98e35742128191c4ea9c364e6cbc1cc40ce7"}}]}},{"name":"package tar file","generatedBy":"teambit.pkg/pkg","storage":"default","task":{"id":"teambit.pkg/pkg","name":"PackComponents"},"files":{"paths":[],"vinyls":[],"refs":[{"relativePath":"package-tar/teambit-community.ui.features.features-card-1.90.4.tgz","ref":{"hash":"dc0cc09633b53c6a88cafb743e4c71de0cfdb87e"}}]}}],"aspectsData":[{"aspectId":"teambit.defender/tester","data":{"tests":{"testFiles":[{"file":"features-card.spec.js","tests":[{"ancestor":[],"name":"should render with the correct text","status":"passed","duration":5}],"pass":1,"failed":0,"pending":0,"duration":624,"slow":false,"error":{}}],"success":true,"start":1644513929793}}},{"aspectId":"teambit.preview/preview","data":{"size":{"files":[{"name":"teambit_community_ui_features_features_card-component.js","size":9265,"compressedSize":2504},{"name":"features-card.b4b78089.css","size":1577,"compressedSize":600}],"assets":[],"totalFiles":10842,"totalAssets":0,"total":10842,"compressedTotalFiles":3104,"compressedTotalAssets":0,"compressedTotal":3104}}},{"aspectId":"teambit.pkg/pkg","data":{"pkgJson":{"name":"@teambit/community.ui.features.features-card","version":"1.90.4","homepage":"https://bit.dev/teambit/community/ui/features/features-card","main":"dist/index.js","componentId":{"scope":"teambit.community","name":"ui/features/features-card","version":"1.90.4"},"dependencies":{"classnames":"2.3.1","core-js":"^3.0.0","@teambit/base-ui.text.paragraph":"1.0.3","@teambit/design.ui.heading":"1.0.7","@teambit/base-react.content.image":"1.90.4"},"devDependencies":{"@types/testing-library__jest-dom":"5.9.5","@babel/runtime":"7.12.18","@types/jest":"^26.0.0","@types/react-dom":"17.0.21","@types/react":"17.0.67","@types/node":"12.20.4","@teambit/design.embeds.figma":"0.0.6","@teambit/community.envs.community-react":"1.90.5"},"peerDependencies":{"@testing-library/react":"12.0.0","react":"^16.8.0 || ^17.0.0"},"license":"SEE LICENSE IN LICENSE","bit":{"bindingPrefix":"@teambit","env":{},"overrides":{"dependencies":{"core-js":"^3.0.0"},"devDependencies":{"@teambit/design.embeds.figma":"0.0.6","@types/testing-library__jest-dom":"5.9.5","@babel/runtime":"7.12.18","@types/jest":"^26.0.0","@types/react-dom":"17.0.21","@types/react":"17.0.67","@types/node":"12.20.4","@types/mocha":"-","react-dom":"-","react":"-"}}}},"tarName":"teambit-community.ui.features.features-card-1.90.4.tgz","checksum":"dc0cc09633b53c6a88cafb743e4c71de0cfdb87e"}}]}';

describe('BuilderData', () => {
  describe('getByAspect()', () => {
    it('should return builder data by aspect', () => {
      const builderData = BuilderData.fromString(MOCK_BUILDER_STRING);
      const aspectData = builderData.getDataByAspect('teambit.preview/preview');
      expect(aspectData.size.totalFiles).to.equal(10842);
    });
  });
});
