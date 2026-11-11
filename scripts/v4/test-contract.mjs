import { spawnSync } from 'node:child_process';
if(process.argv.includes('--refresh-lockfile')){
  const lock = spawnSync('cargo',['generate-lockfile'],{stdio:'inherit'});
  if(lock.status!==0)process.exit(lock.status??1);
}
const result = spawnSync('cargo', ['test', '--workspace', '--locked', ...(process.argv.includes('--offline') ? ['--offline'] : [])], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
if(result.status===0){const cross=spawnSync(process.execPath,['scripts/v4/private-test.mjs'],{stdio:'inherit',timeout:25000});process.exitCode=cross.status??1;}
