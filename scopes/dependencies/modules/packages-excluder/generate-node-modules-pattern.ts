export enum PatternTarget {
  /**
   * Used in Jest `transformIgnorePatterns` options
   */
  JEST = 'jest',
  /**
   * Used in Webpack `snapshot.managedPaths` options
   */
  WEBPACK = 'webpack',
}

type GenerateNodeModulesPatternOptions<T> = {
  /**
   * An array of packages name to exclude in the regex.
   */
  packages?: string[];
  /**
   * The regex should exclude component packages.
   * A component package looks like `@org/scope.namespace.component-name`.
   */
  excludeComponents?: boolean;
  /**
   * The target for which patterns are generated.
   */
  target?: T;
  /**
   * Defines if pnpm is enabled as a package manager
   */
  isPnpmEnabled?: boolean;
};

const patternTargetMap = {
  [PatternTarget.JEST]: toJestPattern,
  [PatternTarget.WEBPACK]: toWebpackPattern,
};

type PatternTargetMap = typeof patternTargetMap;
type PatternReturnType<T extends PatternTarget> = ReturnType<PatternTargetMap[T]>;

/**
 * A function that receives an array of packages names and returns a pattern (string) of a regex that matches any node_modules/package-name except the provided package-names.
 * @param {string[]} packages - array of packages.
 * @returns {string} node modules catched packages regex.
 */
export function generateNodeModulesPattern<T extends PatternTarget>(
  options: GenerateNodeModulesPatternOptions<T> = {}
): PatternReturnType<T> {
  const { packages = [], excludeComponents, target = PatternTarget.JEST, isPnpmEnabled = true } = options;
  return patternTargetMap[target](packages, { excludeComponents, isPnpmEnabled }) as PatternReturnType<T>;
}

type PatternTargetMapOptions<T> = Pick<GenerateNodeModulesPatternOptions<T>, 'excludeComponents' | 'isPnpmEnabled'>;

function toJestPattern<T>(packages: string[], options: PatternTargetMapOptions<T>) {
  const { excludeComponents } = options;
  const patterns = packages.reduce((acc: string[], packageName) => {
    const yarnPattern = packageName.replace(/\//g, '[\\/]');
    const pnpmPackageName = packageName.replace(/\//g, '\\+');
    const pnpmPattern = `\\.pnpm[\\/](.*[+\\/])?${pnpmPackageName}.*`;
    return [...acc, yarnPattern, pnpmPattern];
  }, []);

  if (excludeComponents) {
    patterns.push(
      '@[^/]+/([^/]+\\.)+[^/]+',
      '\\.pnpm/(.+[+/])?@[^+]+\\+([^+]+\\.)+[^+]+',
      '\\.pnpm/.+/node_modules/@[^/]+/([^/]+\\.)+[^/]+'
    );
  }

  return `node_modules/(?!(${patterns.join('|')})/)`;
}

/**
 * Webpack managed paths evaluate absolutes paths to `package.json` files.
 * We need to generate a pattern that excludes the `package.json` files of the bit component packages.
 * Example:
 * - Component package: `@my-org/my-scope.components`
 * - Webpack path: `/Users/aUser/dev/bit-example/node_modules/@my-org/my-scope.components/package.json`
 * - RegExp to exclude this path from managed paths: `/^(.+?[\\/]node_modules[\\/](?!(@my-org[\\/]my-scope.components))(@.+?[\\/])?.+?)[\\/]/`
 */

function toWebpackPattern<T>(packages: string[], { isPnpmEnabled }: PatternTargetMapOptions<T>) {
  const patterns = packages.map((pkg) => pkg.replace(/\//g, '[\\/]'));
  return patterns.map((pattern) => {
    return isPnpmEnabled
      ? `^(.+?[\\/]node_modules[\\/]\\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/](?!(${pattern}))).+`
      : `^(.+?[\\/]node_modules[\\/](?!(${pattern}))).+?[\\/]`;
  });
}
