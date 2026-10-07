// Import boundaries every project gets (gates/boundaries/cli.ts runs dependency-cruiser with this
// file). Generic on purpose: no cycles, and every import resolves. A project with layers of its
// own adds rules in a config that extends this one and passes it with --config.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes both modules one unit that cannot be understood, tested or moved apart.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'An import that resolves to nothing fails at run time; a typo or a missing dependency.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.red-check)/' },
    // Type-only imports count: a cycle through types is still a cycle in the design.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
