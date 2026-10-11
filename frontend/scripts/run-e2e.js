#!/usr/bin/env node
import { spawn } from 'child_process';

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
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
