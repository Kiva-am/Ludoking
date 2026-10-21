// Decode every numeric-arg alias call in index.606d4.js and print:
//   <fileOffset>\t<call>\t<decodedString>
// Uses the real decoder machinery (prefix of the bundle up to the first app-level
// `var a0_0x3b4a27`) plus the alias table from resolver-data.json.
// usage: node tools/re/decode-all.cjs [grepPattern]
const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const ctx=vm.createContext({console});
vm.runInContext(s.slice(0,s.indexOf('var a0_0x3b4a27')),ctx,{timeout:30000});
for(const [n,a] of Object.entries(aliases)){
  try{vm.runInContext(`function ${n}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`,ctx);}catch(e){}
}
const re=/([_a-zA-Z][_a-zA-Z0-9$]*)\(((?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)){1,5})\)/g;
const pat=process.argv[2]?new RegExp(process.argv[2]):null;
let m,out=[];
while((m=re.exec(s))){
  const name=m[1];
  if(typeof ctx[name]!=='function') continue;
  const args=m[2].split(',').map(x=>Number(x.trim()));
  let v; try{v=ctx[name](...args);}catch(e){continue;}
  if(typeof v!=='string') continue;
  const line=`${m.index}\t${m[0]}\t${v}`;
  if(!pat||pat.test(line)) out.push(line);
}
console.log(out.join('\n'));
