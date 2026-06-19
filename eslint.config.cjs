const mmkal = require('eslint-plugin-mmkal')

module.exports = [
  ...mmkal.recommendedFlatConfigs,
  {
    files: ['test/**/*.test.ts'],
    rules: {
      'vitest/no-import-node-test': 'off',
    },
  },
]
