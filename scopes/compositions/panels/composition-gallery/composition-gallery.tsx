import React from 'react';
import type { ComponentModel } from '@teambit/component';
import { Icon } from '@teambit/design.elements.icon';
import { LinkedHeading } from '@teambit/documenter.ui.linked-heading';
import { useNavigate } from '@teambit/base-react.navigation.link';
import { CompositionCard, CompositionCardSkeleton } from '@teambit/composition-card';
import styles from './composition-gallery.module.scss';

export type CompositionGalleryProps = {
  component: ComponentModel;
  isLoading?: boolean;
};

export function CompositionGallery({ component, isLoading }: CompositionGalleryProps) {
  const navigate = useNavigate();
  const hasCompositions = component.compositions.length > 0;

  if (!hasCompositions) return null;

  return (
    <div className={styles.compositionGallery}>
      {/* TODO - @oded replace with panelCard */}
      <LinkedHeading size="sm" className={styles.title}>
        <Icon of="eye" /> <span>PREVIEW</span>
      </LinkedHeading>
      <div className={styles.carousel}>
        {component.compositions.map((composition, index) => {
          if (isLoading && index > 2) return null;
          if (isLoading) return <CompositionCardSkeleton />;
          return (
            <CompositionCard
              key={composition.identifier.toLowerCase()}
              onClick={() => navigate(`~compositions/${composition.identifier.toLowerCase()}`)}
              className={styles.compositionGalleryCard}
              previewClass={styles.preview}
              composition={composition}
              component={component}
            />
          );
        })}
      </div>
    </div>
  );
}
