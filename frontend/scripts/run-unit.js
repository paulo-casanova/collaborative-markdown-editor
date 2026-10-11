#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const vitestArgs = ['run'];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--spec' && i + 1 < args.length) {
    vitestArgs.push(args[++i]);
  } else if (arg.startsWith('--spec=')) {
    vitestArgs.push(arg.split('=')[1]);
  } else {
    vitestArgs.push(arg);
  }
}

const child = spawn('npx', ['vitest', ...vitestArgs], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
