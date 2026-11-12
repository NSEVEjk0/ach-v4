import net from 'node:net';

// near-workspaces' port finder treats every bind failure as an occupied port
// and recurses. Refuse unsupported sandbox networking before entering it.
export default async function sandboxPreflight(){
 await new Promise((resolve,reject)=>{
  const listener=net.createServer();
  listener.once('error',error=>reject(new Error(`LEGACY_SANDBOX_LISTENER_UNAVAILABLE:${error.code??'UNKNOWN'}`)));
  listener.listen(0,'0.0.0.0',()=>listener.close(error=>error?reject(error):resolve()));
 });
}
