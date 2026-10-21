// List every property key accessed as <obj>.serverUserData.<KEY> in the bundle.
// Finds `...serverUser...Data...[KEY]` access sites by decoding the text after
// each decoded 'serverUser' + 'Data' pair.
const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const ctx=vm.createContext({console});
vm.runInContext(s.slice(0,s.indexOf('var a0_0x3b4a27')),ctx,{timeout:30000});
for(const [n,a] of Object.entries(aliases)){
  try{vm.runInContext(`function ${n}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`,ctx);}catch(e){}
}
const callRe=/([_a-zA-Z][_a-zA-Z0-9$]*)\(((?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|-?0x[0-9a-fA-F]+|-?\d+)){1,5})\)/g;
function decodeAt(pos){
  // decode a small window, returning concatenated literal/decoded text
  const win=s.slice(pos,pos+400);
  let out='';
  let last=0; let m;
  const re=new RegExp(callRe.source,'g');
  while((m=re.exec(win))){
    out+=win.slice(last,m.index);
    let v=null;
    if(typeof ctx[m[1]]==='function'){
      try{v=ctx[m[1]](...m[2].split(',').map(x=>Number(x.trim())));}catch(e){}
    }
    out+= (typeof v==='string')? v : m[0];
    last=m.index+m[0].length;
  }
  out+=win.slice(last);
  return out;
}
const tsv=fs.readFileSync('test-results/decoded-strings.tsv','utf8').trim().split('\n').map(l=>l.split('\t'));
const keys=new Map();
for(let i=0;i<tsv.length;i++){
  if(tsv[i][2]!=='serverUser') continue;
  const off=+tsv[i][0];
  const nxt=tsv[i+1];
  if(!nxt||nxt[2]!=='Data'||+nxt[0]-off>140) continue;
  const end=+nxt[0];
  const after=s.slice(end,end+120);
  const m=after.match(/^\]?\s*\[/);
  const keyStart=end + (after.startsWith(']')?1:0) + (after.startsWith('][')?1:0);
  const seg=decodeAt(keyStart);
  const km=seg.match(/^\s*\[([^\[\]]{0,60})\]/);
  if(km){
    const key=km[1].replace(/\s+/g,'');
    keys.set(key,(keys.get(key)||0)+1);
  }
}
console.log([...keys.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${n}\t${k}`).join('\n'));
