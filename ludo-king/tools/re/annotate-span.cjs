// Annotate a method body extracted by explicit start marker + end marker (both literals).
// Usage: node tools/re/annotate-span.cjs <startLiteral> <endLiteral> [maxLen]
const fs=require('fs'),vm=require('vm');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const roots=fs.readFileSync('tools/re/root-decoders.js','utf8');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
const ctx=vm.createContext({console});
vm.runInContext(roots,ctx);
const lines=Object.entries(aliases).map(([n,a])=>`function ${n}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`);
try{vm.runInContext(lines.join('\n'),ctx,{timeout:30000});}catch(e){console.error('sandbox',e.message);}
function ev(name,args){try{return ctx[name](...args);}catch{return null;}}

const startLit=process.argv[2], endLit=process.argv[3];
const maxLen=Number(process.argv[4]||20000);
let i=s.indexOf(startLit);
if(i<0){console.error('start not found: '+startLit);process.exit(1);}
let end=s.indexOf(endLit, i+startLit.length);
if(end<0||end-i>maxLen) end=Math.min(s.length, i+maxLen);
let body=s.slice(i,end);

body=body.replace(/([_a-zA-Z][_a-zA-Z0-9]*)\(((?:0x[0-9a-fA-F]+|-0x[0-9a-fA-F]+|-?\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|-0x[0-9a-fA-F]+|-?\d+)){0,3})\)/g,(full,name,argsStr)=>{
  if(!aliases[name])return full;
  const args=argsStr.split(',').map(x=>Number(x.trim()));
  const v=ev(name,args);
  return typeof v==='string'? `${full}/*${v}*/` : full;
});
console.log(body);
