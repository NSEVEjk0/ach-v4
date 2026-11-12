import {readFileSync,writeFileSync}from 'node:fs';
import {privatePath,repoRoot,manifestPath}from './lib/paths.mjs';
import {requireServiceLayout}from './lib/workflow.mjs';
import {spawnLogged}from './lib/process.mjs';
requireServiceLayout(JSON.parse(readFileSync(manifestPath,'utf8')));
const processes=new Map();let stopping=false;
const roles={coordinator:['coordinator/main.mjs',{}],demo:['demo/main.mjs',{}],research:['agents/main.mjs',{ACH_AGENT_KIND:'research'}],visual:['agents/main.mjs',{ACH_AGENT_KIND:'visual'}],audit:['agents/main.mjs',{ACH_AGENT_KIND:'audit'}],gateway:['gateway.mjs',{}]};
function start(role){if(stopping)return;const[file,extra]=roles[role],child=spawnLogged(process.execPath,['services/'+file],{logPath:privatePath(role+'.log'),cwd:repoRoot,env:{...process.env,...extra}});processes.set(role,child);child.once('error',()=>console.error('ACH_SERVICE_PROCESS_START_FAILED:'+role));child.once('close',()=>{processes.delete(role);if(!stopping)setTimeout(()=>start(role),1500);});}
for(const role of Object.keys(roles))start(role);
writeFileSync(privatePath('supervisor.pid'),String(process.pid),{mode:0o600});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;for(const child of processes.values())child.kill('SIGTERM');setTimeout(()=>process.exit(0),1500);});
