// Helper for the `.kiro/hooks/check-syntax.json` hook.
// Kiro passes hook event context as JSON on STDIN; this script extracts the
// saved file path and runs `node --check` on it. Exits 0 (success) when no
// path can be determined, so the hook never blocks a session on bad context.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

function findFilePath(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const key of ['filePath', 'file_path', 'path', 'file']) {
    if (typeof obj[key] === 'string' && obj[key].endsWith('.js')) return obj[key];
  }
  for (const value of Object.values(obj)) {
    const found = findFilePath(value, depth + 1);
    if (found) return found;
  }
  return null;
}

let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  let target = null;
  try {
    target = findFilePath(JSON.parse(stdin || '{}'));
  } catch {
    target = null;
  }
  if (!target || !fs.existsSync(target)) process.exit(0);
  const check = spawn(process.execPath, ['--check', target], { stdio: 'inherit' });
  check.on('exit', (code) => process.exit(code ?? 0));
  check.on('error', () => process.exit(0));
});
