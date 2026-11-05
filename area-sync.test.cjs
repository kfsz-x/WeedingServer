const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const crypto=require('node:crypto');
test('sparse area IDs survive catch-up, late join, invalid change and full reset',async()=>{
 const child=spawn(process.execPath,[require.resolve('./server.cjs')],{env:{...process.env,WEEDING_PORT:'18793'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',n=>reject(new Error('exit '+n)));});
  const call=async(route,data)=>{const r=await fetch('http://127.0.0.1:18793'+route,{method:'POST',body:JSON.stringify({protocol:10,...data})});return r.json();};
  const salt=Buffer.alloc(16).toString('base64'),hash=crypto.pbkdf2Sync('',Buffer.from(salt,'base64'),10000,32,'sha1').toString('base64');
  const areas={currentArea:2,uniquePulls:10000,areas:[{areaId:2,plantCount:10010,initialized:true,metadataOnly:true,sparsePlants:true,pulledIds:Array.from({length:10000},(_,i)=>i),plants:[]}]};
  const world={contentVersion:3,plants:[],plantData:{plants:[{id:0,position:{x:12}}]},areas};
  const host=await call('/create',{salt,hash,world:JSON.stringify(world)});assert.equal(host.ok,true);const room=host.room;
  const guest=await call('/join',{room,password:''});
  const change={currentArea:2,uniquePulls:10001,changes:[{areaId:2,plantCount:10010,initialized:true,metadataOnly:true,sparsePlants:true,added:[10000],removed:[]}]};
  const patch={sections:80,contentVersion:3,plantCount:10010,sparsePlants:true,coins:0,plants:[],removed:[],areaChanges:[change]};
  assert.equal((await call('/host',{room,token:host.token,patch:JSON.stringify(patch)})).ok,true);
  const late=await call('/join',{room,password:''});
  assert.equal(JSON.parse(late.world).areas.areas[0].pulledIds.length,10001,'late join did not receive added ID');
  assert.deepEqual(JSON.parse(late.world).plantData,world.plantData,'immutable initial layout was damaged');
  await call('/host',{room,token:host.token,patch:JSON.stringify({...patch,areaChanges:[{...change,uniquePulls:10000,changes:[{...change.changes[0],added:[],removed:[4]}]}]})});
  const poll=await call('/poll',{room,token:guest.token,revision:1});const delta=JSON.parse(poll.delta);
  assert.equal(delta.areaChanges.length,2);assert.ok(!delta.areas);assert.ok(Buffer.byteLength(poll.delta)<1500,'sparse reply repeated historical IDs');
  const invalid={...change,changes:[{...change.changes[0],areaId:99}]};
  assert.equal((await call('/host',{room,token:host.token,patch:JSON.stringify({...patch,coins:999,areaChanges:[invalid]})})).ok,false);
  await call('/close',{room,token:late.token});const verify=await call('/join',{room,password:''});const restored=JSON.parse(verify.world);
  assert.equal(restored.coins,0);assert.equal(restored.areas.areas[0].pulledIds.length,10000);assert.ok(!restored.areas.areas[0].pulledIds.includes(4));
  await call('/host',{room,token:host.token,patch:JSON.stringify({...patch,sections:18,areaChanges:[],areas:{...areas,uniquePulls:0,areas:[{...areas.areas[0],pulledIds:[]}]}})});
  const reset=JSON.parse((await call('/poll',{room,token:guest.token,revision:1})).delta);assert.equal(reset.sections&64,0);assert.equal(reset.areaChanges,undefined);assert.deepEqual(reset.areas.areas[0].pulledIds,[]);
  for(let i=0;i<66;i++)await call('/host',{room,token:host.token,patch:JSON.stringify({...patch,areaChanges:[{...change,uniquePulls:1,changes:[{...change.changes[0],added:[1],removed:[]}]}]})});
  const fallback=await call('/poll',{room,token:guest.token,revision:1});assert.deepEqual(JSON.parse(fallback.world).areas.areas[0].pulledIds,[1]);
  await call('/host',{room,token:host.token,world:JSON.stringify({...world,areas:{...areas,currentArea:1}})});
  const switched=await call('/poll',{room,token:guest.token,revision:fallback.revision});assert.equal(JSON.parse(switched.world).areas.currentArea,1);
  await call('/close',{room,token:host.token});
 }finally{child.kill();}
});
