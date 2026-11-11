import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve('newscheck 4');
const output = path.resolve('dist/newscheck');
// Copy only application files; never include keys, tooling or Python environment.
fs.mkdirSync(output,{recursive:true});
for (const name of ['manifest.json','background.js','content.js','sidepanel','options','lib','shared','data','icons']) {
  fs.cpSync(path.join(root,name),path.join(output,name),{recursive:true});
}
function check(dir) {
  for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const file = path.join(dir,item.name);
    if(item.isDirectory()) check(file);
    else if(file.endsWith('.js')) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
  }
}
check(root);
const manifest = JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
for (const file of [manifest.background.service_worker,manifest.side_panel.default_path,manifest.options_page]) {
  if(!fs.existsSync(path.join(output,file))) throw new Error('Missing extension file: '+file);
}
console.log('Extension validated and copied to dist/newscheck');
