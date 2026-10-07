// Jest with ts-jest, as an Angular workspace on Jest sets it up (without the Angular runtime).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
};
