import {spawn}from 'node:child_process';
import {openSync,closeSync}from 'node:fs';
import net from 'node:net';
import {requireServiceLayout}from './workflow.mjs';

export function spawnLogged(command,args,{logPath,...options}){
 const descriptor=openSync(logPath,'a',0o600);
 try{return spawn(command,args,{...options,stdio:['ignore',descriptor,descriptor]});}
 finally{closeSync(descriptor);}
}

export function isNamespaceSupervisor({cwd,args,environment},{repoRoot,privateRoot,manifestPath}){
 return cwd===repoRoot&&args[1]===repoRoot+'/services/supervisor.mjs'&&environment.ACH_V4_PRIVATE_ROOT===privateRoot&&environment.ACH_V4_MANIFEST===manifestPath;
}

const portAvailable=port=>new Promise((resolve,reject)=>{
 const server=net.createServer();
 server.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(new Error('SERVICE_PORT_PREFLIGHT_FAILED')));
 server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));
});
export async function requireAvailableServicePorts(config,probe=portAvailable){
 const layout=requireServiceLayout(config);
 for(const[role,port]of Object.entries(layout.ports))if(!await probe(port))throw new Error(`ISOLATED_SERVICE_PORT_IN_USE:${role}:${port}`);
 return layout;
}
