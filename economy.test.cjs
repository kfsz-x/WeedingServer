const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const {RoomWorld}=require('./world-state.cjs');
test('wallet state survives patches and rejects invalid balances atomically',()=>{
 const state=new RoomWorld('{"plants":[],"coins":10}');
 const economy={shared:false,wallets:[{actor:'host',coins:10},{actor:'a',coins:5}]};
 state.apply({sections:528,coins:10,plants:[],removed:[],economy});assert.deepEqual(JSON.parse(state.snapshot()).economy,economy);
 const before=state.snapshot();assert.throws(()=>state.apply({sections:528,coins:999,plants:[],removed:[],economy:{...economy,wallets:[{actor:'host',coins:-1}]}}));assert.equal(state.snapshot(),before);
});
test('independent rooms reject old clients, preserve catch-up wallet and late join',async()=>{
 const child=spawn(process.execPath,[require.resolve('./server.cjs')],{env:{...process.env,WEEDING_PORT:'18798'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('exit '+c)));});
  const call=async(path,body)=>{const r=await fetch('http://127.0.0.1:18798'+path,{method:'POST',body:JSON.stringify({protocol:10,...body})});return r.json();};
  const salt=Buffer.alloc(16).toString('base64'),hash=crypto.pbkdf2Sync('',Buffer.from(salt,'base64'),10000,32,'sha1').toString('base64');
  const economy={shared:false,wallets:[{actor:'host',coins:10}]},world=JSON.stringify({plants:[],coins:10,economy});
  assert.equal((await call('/address',{})).economySupport,true);
  assert.equal((await call('/create',{salt,hash,world})).code,'ECONOMY_CLIENT_REQUIRED');
  const h=await call('/create',{salt,hash,world,economySupport:true});assert.equal(h.ok,true);
  assert.equal((await call('/join',{room:h.room})).code,'ECONOMY_CLIENT_REQUIRED');
  const g=await call('/join',{room:h.room,economySupport:true});assert.equal(g.ok,true);
  const update={shared:false,wallets:[{actor:'host',coins:10},{actor:g.self,coins:7}]};
  await call('/host',{room:h.room,token:h.token,patch:JSON.stringify({sections:528,coins:10,plants:[],removed:[],economy:update})});
  await call('/host',{room:h.room,token:h.token,patch:JSON.stringify({sections:16,coins:10,plants:[],removed:[]})});
  assert.deepEqual(JSON.parse((await call('/poll',{room:h.room,token:g.token,revision:1})).delta).economy,update);
  const late=await call('/join',{room:h.room,economySupport:true});assert.deepEqual(JSON.parse(late.world).economy,update);
 }finally{child.kill();}
});
