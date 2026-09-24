import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['lib/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['lib/kpi/calendar.js', 'lib/kpi/status.js', 'lib/kpi/admin.js'],
      thresholds: { branches: 100, lines: 100, functions: 100, statements: 100 },
      reporter: ['text'],
    },
  },
})
