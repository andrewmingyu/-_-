import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const git=args=>execFileSync('git',['-c','safe.directory='+root,...args],{encoding:'utf8',maxBuffer:8*1024*1024});
const staged=process.argv.includes('--staged');
const files=[...new Set(git(staged?['diff','--cached','--name-only','--diff-filter=ACM','-z']:['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))]
  .filter(name=>staged || fs.existsSync(path.resolve(root,name)));
const findings=[];
const patterns=[/\bgh[pousr]_[A-Za-z0-9]{20,}\b/,/\bgithub_pat_[A-Za-z0-9_]{30,}\b/,/\bAIza[0-9A-Za-z_-]{30,}\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,/\btvly-[A-Za-z0-9_-]{20,}\b/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const name of files){
  const normalized=name.replaceAll('\\','/');
  if(/(^|\/)(node_modules|dist|\.venv|\.tools|\.npm-cache|\.pytest_cache|__pycache__)(\/|$)/.test(normalized)||(/(^|\/)\.env($|\.)/.test(normalized)&&!normalized.endsWith('/.env.example')&&normalized!=='.env.example')||/\.(pem|key)$/i.test(normalized)){
    findings.push(name+': excluded artifact or secret file');continue;
  }
  if(/\.(png|jpg|jpeg|gif|ico|webp)$/i.test(name))continue;
  const text=staged?git(['show',':'+name]):fs.readFileSync(path.resolve(root,name),'utf8');
  if(patterns.some(pattern=>pattern.test(text)))findings.push(name+': possible credential (value suppressed)');
}
if(findings.length){console.error(findings.join('\n'));process.exit(1);}
console.log('Repository/credential check passed for '+files.length+' '+(staged?'staged':'candidate')+' files.');
