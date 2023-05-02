import { Routes, Route } from 'react-router-dom';
import { MainDropdown, MenuItemSlot } from '@teambit/ui-foundation.ui.main-dropdown';
import { VersionDropdown } from '@teambit/component.ui.version-dropdown';
import { FullLoader } from '@teambit/ui-foundation.ui.full-loader';
import type { ConsumeMethod } from '@teambit/ui-foundation.ui.use-box.menu';
import { useLocation } from '@teambit/base-react.navigation.link';
import { flatten, groupBy, compact, isFunction } from 'lodash';
import classnames from 'classnames';
import React, { useMemo } from 'react';
import { UseBoxDropdown } from '@teambit/ui-foundation.ui.use-box.dropdown';
import { useLanes } from '@teambit/lanes.hooks.use-lanes';
import { LaneModel } from '@teambit/lanes.ui.models.lanes-model';
import { Menu as ConsumeMethodsMenu } from '@teambit/ui-foundation.ui.use-box.menu';
import { LegacyComponentLog } from '@teambit/legacy-component-log';
import type { ComponentModel } from '../component-model';
import { useComponent as useComponentQuery, UseComponentType } from '../use-component';
import { CollapsibleMenuNav } from './menu-nav';
import styles from './menu.module.scss';
import { OrderedNavigationSlot, ConsumeMethodSlot } from './nav-plugin';
import { useIdFromLocation } from '../use-component-from-location';
import { ComponentID } from '../..';
import { Filters } from '../use-component-query';

export type MenuProps = {
  className?: string;
  /**
   * skip the right side.
   */
  skipRightSide?: boolean;
  /**
   * custom render the right side
   */
  RightNode?: React.ReactNode;
  /**
   * slot for top bar menu nav items
   */
  navigationSlot: OrderedNavigationSlot;
  /**
   * right side menu item slot
   */
  widgetSlot: OrderedNavigationSlot;
  /**
   * workspace or scope
   */
  host: string;
  /**
   * main dropdown item slot
   */
  menuItemSlot: MenuItemSlot;

  consumeMethodSlot: ConsumeMethodSlot;

  componentIdStr?: string | (() => string | undefined);

  useComponent?: UseComponentType;

  path?: string;

  useComponentFilters?: () => Filters;
};
function getComponentIdStr(componentIdStr?: string | (() => string | undefined)): string | undefined {
  if (isFunction(componentIdStr)) return componentIdStr();
  return componentIdStr;
}
/**
 * top bar menu.
 */
export function ComponentMenu({
  navigationSlot,
  widgetSlot,
  className,
  host,
  menuItemSlot,
  consumeMethodSlot,
  componentIdStr,
  skipRightSide,
  RightNode,
  useComponent,
  path,
  useComponentFilters,
}: MenuProps) {
  const idFromLocation = useIdFromLocation();
  const _componentIdStr = getComponentIdStr(componentIdStr);
  const componentId = _componentIdStr ? ComponentID.fromString(_componentIdStr) : undefined;
  const resolvedComponentIdStr = path || idFromLocation;

  const useComponentOptions = {
    logFilters: useComponentFilters?.() || {
      log: {
        logLimit: 20,
      },
    },
    customUseComponent: useComponent,
  };

  const snapLogOptions = {
    ...useComponentOptions,
    logFilters: {
      ...useComponentOptions.logFilters,
      log: {
        ...useComponentOptions.logFilters.log,
        type: 'snap',
      },
    },
  };
  const tagLogOptions = {
    ...useComponentOptions,
    logFilters: {
      ...useComponentOptions.logFilters,
      log: {
        ...useComponentOptions.logFilters.log,
        type: 'tag',
      },
    },
  };

  const {
    component: componentTags,
    loadMoreLogs: loadMoreTags,
    hasMoreLogs: hasMoreTags,
    loading: loadingTags,
  } = useComponentQuery(host, componentId?.toString() || idFromLocation, tagLogOptions);

  const {
    component: componentSnaps,
    loadMoreLogs: loadMoreSnaps,
    hasMoreLogs: hasMoreSnaps,
    loading: loadingSnaps,
  } = useComponentQuery(host, componentId?.toString() || idFromLocation, snapLogOptions);

  const mainMenuItems = useMemo(() => groupBy(flatten(menuItemSlot.values()), 'category'), [menuItemSlot]);

  if (loadingTags || loadingSnaps) return <FullLoader />;
  if (!componentSnaps || !componentTags) {
    // eslint-disable-next-line no-console
    console.error(`failed loading component tags/snaps for ${idFromLocation}`);
    return null;
  }

  const RightSide = (
    <div className={styles.rightSide}>
      {RightNode || (
        <>
          <VersionRelatedDropdowns
            componentSnaps={componentSnaps}
            componentTags={componentTags}
            loadMoreSnaps={loadMoreSnaps}
            loadMoreTags={loadMoreTags}
            hasMoreSnaps={hasMoreSnaps}
            hasMoreTags={hasMoreTags}
            loadingSnaps={loadingSnaps}
            loadingTags={loadingTags}
            consumeMethods={consumeMethodSlot}
            host={host}
          />
          <MainDropdown className={styles.hideOnMobile} menuItems={mainMenuItems} />
        </>
      )}
    </div>
  );

  return (
    <Routes>
      <Route
        path={`${resolvedComponentIdStr}/*`}
        element={
          <div className={classnames(styles.topBar, className)}>
            <div className={styles.leftSide}>
              <CollapsibleMenuNav navigationSlot={navigationSlot} widgetSlot={widgetSlot} />
            </div>
            {!skipRightSide && <div className={styles.rightSide}>{RightSide}</div>}
          </div>
        }
      />
    </Routes>
  );
}

export function VersionRelatedDropdowns({
  componentTags,
  componentSnaps,
  consumeMethods,
  loadMoreSnaps,
  loadMoreTags,
  hasMoreSnaps,
  hasMoreTags,
  loadingSnaps,
  loadingTags,
  className,
  host,
}: {
  componentTags: ComponentModel;
  componentSnaps: ComponentModel;
  loadMoreTags?: () => void;
  loadMoreSnaps?: () => void;
  loadingSnaps?: boolean;
  loadingTags?: boolean;
  hasMoreTags?: boolean;
  hasMoreSnaps?: boolean;
  consumeMethods?: ConsumeMethodSlot;
  className?: string;
  host: string;
}) {
  const location = useLocation();
  const loading = loadingSnaps || loadingTags;
  const { lanesModel } = useLanes();
  const component = componentTags || componentSnaps;
  const viewedLane =
    lanesModel?.viewedLane?.id && !lanesModel?.viewedLane?.id.isDefault() ? lanesModel.viewedLane : undefined;
  // const { logs } = component;
  const isWorkspace = host === 'teambit.workspace/workspace';

  const snaps = useMemo(() => {
    return (componentSnaps.logs || []).filter((log) => !log.tag).map((snap) => ({ ...snap, version: snap.hash }));
  }, [componentSnaps.logs]);

  const tags = useMemo(() => {
    return (componentTags.logs || []).map((tag) => ({ ...tag, version: tag.tag as string }));
  }, [componentTags.logs]);

  const isNew = snaps.length === 0 && tags.length === 0;

  const lanes = lanesModel?.getLanesByComponentId(component.id)?.filter((lane) => !lane.id.isDefault()) || [];
  const localVersion = isWorkspace && !isNew && (!viewedLane || lanesModel?.isViewingCurrentLane());

  const currentVersion =
    isWorkspace && !isNew && !location?.search.includes('version') ? 'workspace' : component.version;
  const VERSION_TAB_NAMES = ['TAG', 'SNAP', 'LANE'] as const;
  const tabs = VERSION_TAB_NAMES.map((name) => {
    switch (name) {
      case 'SNAP':
        return { name, payload: snaps || [] };
      case 'LANE':
        return { name, payload: lanes || [] };
      default:
        return { name, payload: tags || [] };
    }
  }).filter((tab) => tab.payload.length > 0);

  const methods = useConsumeMethods(component, consumeMethods, viewedLane);

  const getActiveTabIndex = () => {
    if (viewedLane?.components.some((c) => c.version === currentVersion))
      return tabs.findIndex((tab) => tab.name === 'LANE');
    if ((snaps || []).some((snap) => snap.version === currentVersion))
      return tabs.findIndex((tab) => tab.name === 'SNAP');
    return 0;
  };

  const [activeTabIndex, setActiveTab] = React.useState<number>(getActiveTabIndex());
  const activeTabOrSnap: 'SNAP' | 'TAG' | 'LANE' = tabs[activeTabIndex]?.name || tabs[0].name;
  const hasMore = activeTabOrSnap === 'SNAP' ? hasMoreSnaps : hasMoreTags;
  const observer = React.useRef<IntersectionObserver>();

  const handleLoadMore = React.useCallback(() => {
    if (activeTabOrSnap === 'SNAP') loadMoreSnaps?.();
    if (activeTabOrSnap === 'TAG') loadMoreTags?.();
  }, [activeTabIndex, tabs.length]);

  const lastLogRef = React.useCallback(
    (node) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          handleLoadMore();
        }
      });
      if (node) observer.current.observe(node);
    },
    [loading, hasMoreSnaps, hasMoreTags, activeTabIndex]
  );

  return (
    <>
      {consumeMethods && tags.length > 0 && (
        <UseBoxDropdown
          position="bottom-end"
          className={classnames(styles.useBox, styles.hideOnMobile)}
          Menu={<ConsumeMethodsMenu methods={methods} componentName={component.id.name} />}
        />
      )}
      <VersionDropdown
        ref={lastLogRef}
        tags={tags}
        snaps={snaps}
        tabs={tabs}
        activeTabIndex={activeTabIndex}
        setActiveTabIndex={setActiveTab}
        localVersion={localVersion}
        currentVersion={currentVersion}
        latestVersion={component.latest}
        currentLane={viewedLane}
        className={className}
        menuClassName={styles.componentVersionMenu}
      />
    </>
  );
}

function useConsumeMethods(
  componentModel?: ComponentModel,
  consumeMethods?: ConsumeMethodSlot,
  currentLane?: LaneModel
): ConsumeMethod[] {
  // if (!consumeMethods || !componentModel) return [];
  return useMemo(
    () =>
      flatten(consumeMethods?.values())
        .map((method) => {
          if (!componentModel) return undefined;
          return method?.(componentModel, { currentLane });
        })
        .filter((x) => !!x && x.Component && x.Title) as ConsumeMethod[],
    [consumeMethods, componentModel, currentLane]
  );
}
