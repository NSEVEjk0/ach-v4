import {createRequire}from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync,rmSync}from 'node:fs';
import {tmpdir}from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL}from 'node:url';

// Execute the same TypeScript helpers used by Next, without importing its
// server runtime or reaching a deployment. Next's build checks their types.
export function localWebModules({components=false}={}){
 const require=createRequire(new URL('../../web/package.json',import.meta.url)),ts=require('typescript'),directory=mkdtempSync(path.join(tmpdir(),'ach-web-unit-'));
 for(const name of ['v4','intents','request','history','gateway','clearing','proxy']){
  const location=name==='proxy'?'../../web/app/api/v4/[...path]/route.ts':`../../web/lib/${name}.ts`;
  const source=readFileSync(fileURLToPath(new URL(location,import.meta.url)),'utf8').replace("from 'next/server'",`from '${pathToFileURL(require.resolve('next/server')).href}'`).replace(/from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/(gateway|request)'/g,(_,helper)=>`from './${helper}.mjs'`).replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${relative.endsWith('.mjs')?relative:relative+'.mjs'}'`);
  writeFileSync(path.join(directory,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ES2022}}).outputText,{mode:0o600});
 }
 if(components)for(const name of ['Interface','WorkForm','NettingTest']){
  const source=readFileSync(fileURLToPath(new URL(`../../web/components/v4/${name}.tsx`,import.meta.url)),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from (['"])(react|react\/jsx-runtime|lucide-react)\1/g,(_,quote,specifier)=>`from '${pathToFileURL(require.resolve(specifier)).href}'`).replace(/from ['"]\.\/Interface['"]/g,"from './Interface.mjs'").replace(/from ['"]\.\.\/\.\.\/lib\/v4['"]/g,"from './v4.mjs'");
  writeFileSync(path.join(directory,name+'.mjs'),compiled,{mode:0o600});
 }
 return{url:name=>pathToFileURL(path.join(directory,name+'.mjs')).href,nextServerUrl:pathToFileURL(require.resolve('next/server')).href,reactUrl:pathToFileURL(require.resolve('react')).href,reactServerUrl:pathToFileURL(require.resolve('react-dom/server')).href,cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
