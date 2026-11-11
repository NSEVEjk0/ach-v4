// Explicit ACH v4 deployment entry. Never reads the legacy clearing.wasm.
await import(process.argv.includes('--outlayer')?'./v4/outlayer.mjs':process.argv.includes('--services')?'./v4/services.mjs':process.argv.includes('--web')?'./v4/web.mjs':'./v4/deploy.mjs');
