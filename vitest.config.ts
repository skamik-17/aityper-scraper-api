import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/types/normalization.ts', // Old type system, will be removed
      ],
      // Coverage thresholds
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      }
    },
    // Test timeout
    testTimeout: 10000,
    // Watch mode settings
    watch: true,
  });
