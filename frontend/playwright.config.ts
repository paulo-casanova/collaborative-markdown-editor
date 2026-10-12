import { defineConfig, devices } from '@playwright/test';

const testBackendPort = process.env.TEST_BACKEND_PORT || '8088';
const testDbUrl = process.env.TEST_DB_URL || 'postgresql://cme:secret@localhost:5432/cme_e2e';
const testStorageDir = process.env.TEST_STORAGE_DIR || '/tmp/cme_e2e_storage';
const previewPort = process.env.PREVIEW_PORT || '4173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `rm -rf ${testStorageDir} && mkdir -p ${testStorageDir}/content && /home/pasc/cme/build/bin/cme-server --data-dir ${testStorageDir} --db-url "${testDbUrl}" --port ${testBackendPort}`,
      url: `http://127.0.0.1:${testBackendPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `VITE_BACKEND_PORT=${testBackendPort} npm run preview -- --port ${previewPort}`,
      url: `http://127.0.0.1:${previewPort}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
