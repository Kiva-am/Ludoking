import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCloneServer} from '../server.mjs';

async function fixture(t){
  const server=createCloneServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('uses the original Cocos assets and not the redesigned board',async t=>{
  const origin=await fixture(t);const response=await fetch(origin);const html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/GameCanvas/);assert.match(html,/settings\.31bd1/);
  assert.doesNotMatch(html,/Ludo Room|\/app\.js|accounts\.google\.com|googlesyndication/);
  assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
  for(const path of ['/play/cocos2d-js-min.63e9f.js','/play/assets/main/config.606d4.json','/play/assets/resources/config.001a6.json']){
    assert.equal((await fetch(origin+path)).status,200,path);
  }
});

test('replays only public configuration and refuses arbitrary upstream services',async t=>{
  const origin=await fixture(t);
  const response=await fetch(origin+'/local-config');assert.equal(response.status,200);
  assert.ok((await response.json()).turn_timers);
  assert.equal((await fetch(origin+'/unavailable-service')).status,501);
  assert.equal((await fetch(origin+'/captured/http.json')).status,404);
  assert.equal((await fetch(origin+'/server.mjs')).status,404);
  assert.equal((await fetch(origin+'/local-config',{method:'POST'})).status,405);
});

test('limits the navigation adaptation to the single observed assignment',async t=>{
  const origin=await fixture(t);
  const path='assets/main/index.606d4.js';
  const archived=await readFile(new URL('../public/play/'+path,import.meta.url),'utf8');
  const served=await(await fetch(origin+'/play/'+path)).text();
  const original='_0x444c3b[_0x36d6d8][_0x12d343]=_0x2f86b3;';
  assert.equal(archived.split(original).length,2);
  assert.doesNotMatch(served,/_0x444c3b\[_0x36d6d8\]\[_0x12d343\]=_0x2f86b3;/);
  const expected='(function(window){\n'+archived.replace(original,"window.__localEvents.push({type:'blocked-navigation',detail:'observed-host-redirect'});")+'\n})(window.__localClientWindow);\n';
  assert.equal(served,expected);
  const manifest=JSON.parse(await readFile(new URL('../asset-manifest.json',import.meta.url),'utf8'));
  const originalHash=manifest.files.find(file=>file.path===path).sha256;
  assert.equal(createHash('sha256').update(archived).digest('hex'),originalHash);
  assert.deepEqual(manifest.failed,[]);
});
