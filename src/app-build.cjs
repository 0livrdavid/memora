const fs=require('node:fs'),path=require('node:path');
function readBuild(app){
 const executable=app.getPath('exe'),marker=executable.lastIndexOf('.app'+path.sep),bundle=marker>=0?executable.slice(0,marker+4):path.dirname(executable);let id='desenvolvimento';
 try{const value=JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'memora-build.json'),'utf8'));if(typeof value.build==='string'&&/^[a-zA-Z0-9._-]{1,120}$/.test(value.build))id=value.build;}catch{}
 return {id,bundle,version:app.getVersion()};
}
module.exports={readBuild};
