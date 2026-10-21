// Annotate a span of index.606d4.js with decoded strings.
// Local wrapper functions defined inside the span override the global alias table,
// which fixes garbling caused by reused identifier names across scopes.
// usage: node tools/re/annotate-span2.cjs <startOffset> <endOffset>
const fs=require('fs'),vm=require('vm');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const roots=fs.readFileSync('tools/re/root-decoders.js','utf8');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
const start=Number(process.argv[2]), end=Number(process.argv[3]);
const body=s.slice(start,end);

const ctx=vm.createContext({console});
// Use the real decoder machinery from the bundle prefix (root-decoders.js alone
// misses part of the init and yields garbage for some roots).
vm.runInContext(s.slice(0,s.indexOf('var a0_0x3b4a27')),ctx,{timeout:30000});
function defAlias(n,a){try{vm.runInContext(`function ${n}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`,ctx);}catch(e){}}
for(const [n,a] of Object.entries(aliases)) defAlias(n,a);
// local wrappers inside span: function NAME(a,b,c,d){return TARGET(...);}
const re=/function\s+([_a-zA-Z][_a-zA-Z0-9$]*)\(\s*([_a-zA-Z][_a-zA-Z0-9$]*(?:\s*,\s*[_a-zA-Z][_a-zA-Z0-9$]*)*)\s*\)\s*\{\s*return\s+([_a-zA-Z][_a-zA-Z0-9$]*)\(([^;]*?)\);\s*\}/g;
let m;
while((m=re.exec(body))){
  const [,name,paramsStr,target,argsStr]=m;
  try{vm.runInContext(`function ${name}(${paramsStr}){return ${target}(${argsStr});}`,ctx);}catch(e){}
}
function ev(name,args){try{return ctx[name](...args);}catch{return null;}}
const out=body.replace(/([_a-zA-Z][_a-zA-Z0-9$]*)\(((?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)){0,5})\)/g,(full,name,argsStr)=>{
  if(typeof ctx[name]!=='function') return full;
  const args=argsStr.split(',').map(x=>Number(x.trim()));
  const v=ev(name,args);
  return typeof v==='string'? `${full}/*${JSON.stringify(v)}*/` : full;
});
console.log(out);
