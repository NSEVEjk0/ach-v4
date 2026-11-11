import {spawn}from 'node:child_process';
import {openSync,writeFileSync}from 'node:fs';
import {privatePath,repoRoot}from './lib/paths.mjs';
const processes=new Map();let stopping=false;
const roles={coordinator:['coordinator/main.mjs',{}],demo:['demo/main.mjs',{}],research:['agents/main.mjs',{ACH_AGENT_KIND:'research'}],visual:['agents/main.mjs',{ACH_AGENT_KIND:'visual'}],audit:['agents/main.mjs',{ACH_AGENT_KIND:'audit'}],gateway:['gateway.mjs',{}]};
function start(role){if(stopping)return;const[file,extra]=roles[role],log=openSync(privatePath(role+'.log'),'a',0o600),child=spawn(process.execPath,['services/'+file],{cwd:repoRoot,env:{...process.env,...extra},stdio:['ignore',log,log]});processes.set(role,child);child.once('exit',()=>{processes.delete(role);if(!stopping)setTimeout(()=>start(role),1500);});}
for(const role of Object.keys(roles))start(role);
writeFileSync(privatePath('supervisor.pid'),String(process.pid),{mode:0o600});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;for(const child of processes.values())child.kill('SIGTERM');setTimeout(()=>process.exit(0),1500);});
