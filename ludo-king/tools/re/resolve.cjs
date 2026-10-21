// Resolve obfuscated decoder call sites to plaintext.
// Usage: node resolve.cjs <alias> <arg1> <arg2> <arg3> <arg4>
const fs=require('fs'),vm=require('vm');
const {aliases}=JSON.parse(fs.readFileSync('tools/re/resolver-data.json','utf8'));
const roots=fs.readFileSync('tools/re/root-decoders.js','utf8');
const ctx=vm.createContext({console});
vm.runInContext(roots,ctx,{filename:'roots.js'});
const ROOTS={a0_0x1890:ctx.a0_0x1890,a0_0x293ccb:ctx.a0_0x293ccb,a0_0x41b14f:ctx.a0_0x41b14f};

// Build a JS evaluator for a call by generating source that inlines the chain.
function buildExpr(name,args){
  // substitute numbers into the alias call to produce a raw string expression
  const argStr=args.map(a=>typeof a==='number'?a.toString():a).join(',');
  // Generate: (function(p0,p1,p2,p3){ ... chain ... })(...)
  const chain=[];
  let cur=name, params=['p0','p1','p2','p3'], guard=0, finalTarget=null, finalCall=null;
  while(aliases[cur]&&guard++<100){
    const a=aliases[cur];
    // map current params to this alias's params (same order)
    chain.push({name:cur,params:a.params,callArgs:a.callArgs,target:a.target});
    if(/^a0_0x/.test(a.target)){finalTarget=a.target;finalCall=a.callArgs;break;}
    cur=a.target;
  }
  return {chain,finalTarget,finalCall};
}
// Simpler: evaluate by defining every alias as a real function in a sandbox that
// forwards to the roots, then call it. Since aliases call other aliases by name,
// defining ALL aliases as functions lets JS resolve the chain naturally.
function buildSandbox(){
  const lines=[];
  for(const [name,a] of Object.entries(aliases)){
    lines.push(`function ${name}(${a.params.join(',')}){return ${a.target}(${a.callArgs});}`);
  }
  return roots+'\n'+lines.join('\n');
}
let sandboxReady=null;
function evalCall(name,args){
  if(!sandboxReady){
    const code=buildSandbox();
    try{ vm.runInContext(code,ctx,{filename:'all.js',timeout:20000}); sandboxReady=true; }
    catch(e){ return {error:'sandbox build failed: '+e.message}; }
  }
  try{ return {value: ctx[name](...args)}; }catch(e){ return {error:e.message}; }
}
module.exports={evalCall};
if(require.main===module){
  const [,,name,...rest]=process.argv;
  const args=rest.map(x=>x.startsWith('0x')?parseInt(x,16):Number(x));
  console.log(JSON.stringify(evalCall(name,args)));
}
