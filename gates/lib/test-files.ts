// Which paths hold tests: vitest's and jest's defaults, `*.test.*` and `*.spec.*`, outside
// node_modules. The test-deletion guard and the red check both read test files this way.

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export const isTestFile = (p: string) => TEST_FILE.test(p) && !p.split('/').includes('node_modules');
