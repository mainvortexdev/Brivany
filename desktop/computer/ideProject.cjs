/* Typed IDE launch adapter: a verified local preview, never a shell string. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function digest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function readConfiguration(file,expectedHash){
 if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('Missing launch seal.');
 file=path.resolve(file);const bytes=fs.readFileSync(file);if(bytes.length>32768||digest(bytes)!==expectedHash)throw Error('The IDE launch configuration changed.');
 const value=JSON.parse(bytes),root=path.resolve(file,'../../..');
 if(!/^[a-f0-9-]{36}$/.test(value.id)||!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw Error('Invalid local preview identity.');
 function exact(actual,expected){if(typeof actual!=='string'||path.resolve(actual)!==path.resolve(expected)||fs.realpathSync(actual)!==path.resolve(expected))throw Error('Unexpected or linked project path.');}
 exact(value.work,path.join(root,'work'));
 exact(value.python,value.python);
 if(!/^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(path.basename(value.python))||digest(fs.readFileSync(value.python))!==value.python_sha256)throw Error('Unexpected Python interpreter.');
 exact(value.site_packages,path.join(root,'python-env',process.platform==='win32'?'Lib/site-packages':value.site_relative||''));
 exact(value.runner,path.resolve(__dirname,'../../services/terminal/preview_server.py'));
 if(digest(fs.readFileSync(value.runner))!==value.runner_sha256)throw Error('The preview adapter changed; prepare the IDE launch again.');
 return value;
}
function start(file,hash){
 const config=readConfiguration(file,hash),allowed=new Set(['SYSTEMROOT','WINDIR','SYSTEMDRIVE','COMSPEC','PATH','PATHEXT','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','TEMP','TMP','HOME','LANG','LC_ALL']);
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
 const child=require('node:child_process').spawn(config.python,['-I',config.runner,path.resolve(file),String(process.pid)],{cwd:config.work,env,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
 child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=Number.isInteger(code)?code:1;});
 console.log('MELODI_IDE_LAUNCH '+JSON.stringify({owner_pid:process.pid,server_pid:child.pid,url:'http://127.0.0.1:'+config.port,proof:config.id,financial_actions:false}));
 const stop=()=>{if(child.exitCode===null)child.kill();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
module.exports={readConfiguration};
if(require.main===module){try{start(process.argv[2],process.argv[3]);}catch(error){console.error(error.message);process.exitCode=1;}}
