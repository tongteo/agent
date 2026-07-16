/**
 * @fileoverview Jest configuration for agent CLI project.
 * Uses CommonJS mode (no transform needed for vanilla JS).
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  verbose: true,
};
