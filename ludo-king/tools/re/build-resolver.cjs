const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('public/play/assets/main/index.606d4.js','utf8');
function extract(fn){const i=s.indexOf('function '+fn+'(');if(i<0)return null;let j=s.indexOf('{',i),d=0,k=j;while(k<s.length){if(s[k]==='{')d++;else if(s[k]==='}'){d--;if(d===0)break;}k++;}return s.slice(i,k+1);}
// root decoders
const roots=['a0_0x1890','a0_0x293ccb','a0_0x41b14f','a0_0x5c9d'];
const rootSrc=roots.map(extract).filter(Boolean).join('\n');
// alias map: name -> {target, argMap}  (we'll only resolve simple 1:1 forwards)
const aliasRe=/function (_0x[0-9a-f]+)\((_0x[0-9a-f]+),(_0x[0-9a-f]+),(_0x[0-9a-f]+),(_0x[0-9a-f]+)\)\{return (_0x[0-9a-f]+|a0_0x[0-9a-f]+)\(([^)]*)\);\}/g;
const aliases={};
let m;
while((m=aliasRe.exec(s))){
  aliases[m[1]]={target:m[6],params:[m[2],m[3],m[4],m[5]],callArgs:m[7]};
}
console.log('aliases parsed:',Object.keys(aliases).length);
fs.writeFileSync('tools/re/resolver-data.json',JSON.stringify({roots,aliases}));
fs.writeFileSync('tools/re/root-decoders.js',rootSrc);
console.log('roots length',rootSrc.length);
