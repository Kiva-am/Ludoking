// Decode every decoder call site inside a named method body and print the source
// with plaintext string annotations.
const fs=require('fs'),vm=require('vm');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const roots=fs.readFileSync('tools/re/root-decoders.js','utf8');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
const ctx=vm.createContext({console});
vm.runInContext(roots,ctx);
const lines=Object.entries(aliases).map(([n,a])=>`function ${n}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`);
try{vm.runInContext(lines.join('\n'),ctx,{timeout:30000});}catch(e){console.error('sandbox',e.message);}
function ev(name,args){try{return ctx[name](...args);}catch{return null;}}
const method=process.argv[2];
const key=`.${method}':function`;   // matches 'name':function
let i=s.indexOf("'"+method+"':function");
if(i<0) i=s.indexOf('"'+method+'":function');
if(i<0){console.error('method not found: '+method);process.exit(1);}
const rest=s.slice(i+10);
const m=rest.match(/,'[A-Za-z_$][A-Za-z_0-9$]*':function/);
const end=m?i+10+m.index:i+20000;
let body=s.slice(i,end);
// Replace every ALIAS(a,b,c,d) with ALIAS(a,b,c,d) /* decoded */
body=body.replace(/([_a-zA-Z][_a-zA-Z0-9]*)\(((?:0x[0-9a-f]+|-?0x[0-9a-f]+|[0-9]+)(?:\s*,\s*(?:0x[0-9a-f]+|-?0x[0-9a-f]+|[0-9]+)){0,3})\)/g,(full,name,argsStr)=>{
  if(!aliases[name])return full;
  const args=argsStr.split(',').map(x=>Number(x.trim()));
  const v=ev(name,args);
  return typeof v==='string'? `${full}/*${v}*/` : full;
});
console.log(body);
