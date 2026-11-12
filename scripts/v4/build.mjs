import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`BUILD_FAILED:${command}`);
}
const rustflags = '-C target-feature=-reference-types,-multivalue,-bulk-memory';
const offline = process.argv.includes('--offline') ? ['--offline'] : [];
run('cargo', ['build', '--locked', ...offline, '--release', '--target', 'wasm32-unknown-unknown', '-p', 'ach-vault', '-p', 'ach-test-usdc'], { env: { ...process.env, RUSTFLAGS: rustflags } });
run('cargo', ['build', '--locked', ...offline, '--release', '--target', 'wasm32-wasip2', '-p', 'ach-private-netting']);
run('npm', ['run', 'build', '--prefix', 'packages/client']);
run('npm', ['run', 'build', '--prefix', 'packages/intents']);
mkdirSync('target', { recursive: true });
const artifact = (filename) => ({ path: filename, bytes: readFileSync(filename).length, sha256: createHash('sha256').update(readFileSync(filename)).digest('hex') });
const manifest = {
  protocol_version: 4,
  workflow_revision:2,
  built_at: new Date().toISOString(),
  artifacts: {
    vault: artifact('target/wasm32-unknown-unknown/release/ach_vault.wasm'),
    token: artifact('target/wasm32-unknown-unknown/release/ach_test_usdc.wasm'),
    worker: artifact('target/wasm32-wasip2/release/ach-private-netting.wasm'),
  },
};
writeFileSync(path.resolve('target/ach-build.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
