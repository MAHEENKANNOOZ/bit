import { Component } from '@teambit/component';
import gql from 'graphql-tag';

import { PreviewMain } from './preview.main.runtime';

export function previewSchema(previewExtension: PreviewMain) {
  return {
    typeDefs: gql`
      type Preview {
        # url: String!
        """
        Check if the component supports scaling
        """
        isScaling: Boolean
        includesEnvTemplate: Boolean
        legacyHeader: Boolean
        """
        @deprecated use onlyOverview
        """
        skipIncludes: Boolean
        onlyOverview: Boolean
        includesNameParam: Boolean
      }

      extend type Component {
        preview: Preview
      }
    `,
    resolvers: {
      Component: {
        preview: (component: Component) => {
          // return previewExtension.getPreview(component);
          return { component };
        },
      },
      Preview: {
        includesEnvTemplate: ({ component }) => {
          return previewExtension.isBundledWithEnv(component);
        },
        isScaling: ({ component }) => {
          return previewExtension.doesScaling(component);
        },
        legacyHeader: ({ component }) => {
          return previewExtension.isLegacyHeader(component);
        },
        onlyOverview: ({ component }) => {
          // return true;
          return previewExtension.includesOnlyOverview(component);
        },
        includesNameParam: ({ component }) => {
          return previewExtension.includesNameParam(component);
        },
      },
    },
  };
}
