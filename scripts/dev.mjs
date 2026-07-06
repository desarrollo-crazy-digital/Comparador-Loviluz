import { spawn } from 'node:child_process';

function run(command, args, name) {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = code;
    }
  });
  child.on('error', (err) => {
    console.error(`[${name}] failed to start:`, err);
    process.exitCode = 1;
  });
  return child;
}

const api = run('node', ['server.js'], 'api');
const vite = run('npx', ['vite'], 'vite');

const shutdown = () => {
  try { api.kill('SIGTERM'); } catch {}
  try { vite.kill('SIGTERM'); } catch {}
};

process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
