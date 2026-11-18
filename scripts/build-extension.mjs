import { cp, mkdir, rm } from 'node:fs/promises';
const target='dist/extension';
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp('web/build',target,{recursive:true});
await cp('extension/manifest.json',target+'/manifest.json');
await cp('extension/background.js',target+'/background.js');
console.log('Extension created at',target);
