'use strict';
// Run by the restore container as the application's exact identity.
const fs=require('node:fs'),path=require('node:path');
if(process.getuid()!==1000||process.getgid()!==1000)throw Error('Wrong restore verification identity');
function visit(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.uid!==1000||s.gid!==1000||(s.mode&0o077))throw Error('Unsafe restored ownership or mode');
 if(s.isDirectory()){fs.accessSync(p,fs.constants.R_OK|fs.constants.X_OK);for(const n of fs.readdirSync(p))visit(path.join(p,n));}
 else if(s.isFile()){const fd=fs.openSync(p,'r');fs.closeSync(fd);}else throw Error('Unsafe entry');}
visit('/photos/data');console.log('Restored archive accessible as application UID 1000.');
