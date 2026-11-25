// Which paths hold tests: vitest's and jest's defaults, `*.test.*` and `*.spec.*`, and pytest's,
// `test_*.py` and `*_test.py` (ticket 99), outside node_modules and Python virtual environments.
// The test-deletion guard and the red check both read test files this way.

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PYTEST_FILE = /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;
const NOT_PROJECT = ['node_modules', '.venv', 'venv'];

export const isTestFile = (p: string) => (TEST_FILE.test(p) || PYTEST_FILE.test(p)) && !p.split('/').some((part) => NOT_PROJECT.includes(part));
