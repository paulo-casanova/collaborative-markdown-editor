#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// 1. Prepare isolated E2E database & test users
try {
  // Apply migrations to cme_e2e
  execSync(
    `"${projectRoot}/build/bin/cme-migrate" --db "postgresql://cme:secret@localhost:5432/cme_e2e" --migrations-dir "${projectRoot}/migrations"`,
    { stdio: 'inherit' }
  );

  // Truncate existing documents in cme_e2e
  execSync(
    `docker exec cme-postgres psql -U cme -d cme_e2e -c "TRUNCATE documents CASCADE;"`,
    { stdio: 'inherit' }
  );

  // Ensure test users exist with exact roles in cme_e2e
  const cmeAdmin = `${projectRoot}/build/bin/cme-admin`;
  const dbParam = `--db "postgresql://cme:secret@localhost:5432/cme_e2e"`;

  const users = [
    { username: 'test_admin', pass: 'password123', display: 'Super Admin', admin: true },
    { username: 'ws_tester', pass: 'password123', display: 'WebSocket Tester', admin: true },
    { username: 'bob_auth_test', pass: 'password123', display: 'Bob Tester', admin: false },
  ];

  for (const u of users) {
    try {
      execSync(
        `"${cmeAdmin}" ${dbParam} user reset-password --username "${u.username}" --password "${u.pass}"`,
        { stdio: 'ignore' }
      );
    } catch {
      const adminFlag = u.admin ? '--admin' : '';
      execSync(
        `"${cmeAdmin}" ${dbParam} user create --username "${u.username}" --password "${u.pass}" --display-name "${u.display}" ${adminFlag}`,
        { stdio: 'inherit' }
      );
    }
    execSync(
      `docker exec cme-postgres psql -U cme -d cme_e2e -c "UPDATE users SET display_name = '${u.display}', is_system_admin = ${u.admin} WHERE username = '${u.username}';"`,
      { stdio: 'inherit' }
    );
  }
} catch (err) {
  console.warn('[run-e2e] Warning during test DB prep:', err.message);
}

// 2. Launch Playwright
const rawArgs = process.argv.slice(2);
const parsedArgs = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--spec') {
    if (rawArgs[i + 1]) {
      parsedArgs.push(rawArgs[i + 1]);
      i++;
    }
  } else if (rawArgs[i].startsWith('--spec=')) {
    parsedArgs.push(rawArgs[i].split('=')[1]);
  } else {
    parsedArgs.push(rawArgs[i]);
  }
}

const child = spawn('npx', ['playwright', 'test', ...parsedArgs], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    TEST_BACKEND_PORT: '8088',
    VITE_BACKEND_PORT: '8088',
    TEST_API_URL: 'http://127.0.0.1:8088',
    TEST_DB_URL: 'postgresql://cme:secret@localhost:5432/cme_e2e',
    TEST_STORAGE_DIR: '/tmp/cme_e2e_storage',
  },
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
