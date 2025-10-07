/** Jest config for TypeScript */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/tests/setupIndexedDB.ts'],
  testMatch: ['**/tests/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@/components/Bottom/BottomPanel$': '<rootDir>/tests/__mocks__/BottomPanelMock.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
