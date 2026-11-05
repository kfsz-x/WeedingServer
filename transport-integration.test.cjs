const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{gunzipSync,gzipSync}=require('node:zlib'),{spawn}=require('node:child_process'),{WebSocket}=require('ws');
test('real server snapshot authorization, compressed chunks and websocket field push',async()=>{
 const child=spawn(process.execPath,[require.resolve('./server.cjs')],{env:{...process.env,WEEDING_PORT:'18794'},stdio:['ignore','pipe','pipe']});let ws;
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',n=>reject(new Error('exit '+n)));});
  const call=async(route,data)=>{const r=await fetch('http://127.0.0.1:18794'+route,{method:'POST',body:JSON.stringify({protocol:10,...data})});return r.json();};
  const salt=Buffer.alloc(16).toString('base64'),hash=crypto.pbkdf2Sync('',Buffer.from(salt,'base64'),10000,32,'sha1').toString('base64');
  const world=JSON.stringify({plants:[],message:'草😀'.repeat(40000),tools:{gloveLevel:2,items:[{id:1,kind:'vacuum',owner:'host'},{id:2,kind:'mower',owner:'guest'}]},progress:{exitUnlocked:false,settled:false,players:[{playerId:'a',pulls:4,seconds:1}]}});
  const compressedWorld={encoding:'gzip-base64',rawBytes:Buffer.byteLength(world),hash:crypto.createHash('sha256').update(world).digest('hex'),data:gzipSync(world).toString('base64')};
  const host=await call('/create',{salt,hash,world:'',compressedWorld});assert.equal(host.ok,true);
  const guest=await call('/join',{room:host.room,password:'',snapshotSupport:true});assert.equal(guest.ok,true);assert.equal(guest.world,undefined);assert.equal(guest.snapshot.encoding,'gzip-base64');
  assert.equal((await call('/snapshot',{room:host.room,token:'wrong',snapshotId:guest.snapshot.id,index:0})).ok,false);
  const bytes=[];for(let index=0;index<guest.snapshot.totalChunks;index++){const r=await call('/snapshot',{room:host.room,token:guest.token,snapshotId:guest.snapshot.id,index});assert.equal(r.ok,true);bytes.push(Buffer.from(r.data,'base64'));}
  const decoded=gunzipSync(Buffer.concat(bytes));assert.equal(decoded.toString(),world);assert.equal(crypto.createHash('sha256').update(decoded).digest('hex'),guest.snapshot.hash);
  ws=new WebSocket('ws://127.0.0.1:18794/room-ws');await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  let seq=0;const pending=new Map(),pushes=[];
  ws.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='push')pushes.push(JSON.parse(e.body));else if(pending.has(e.id)){pending.get(e.id)(JSON.parse(e.body));pending.delete(e.id);}});
  const rpc=(path,body)=>new Promise((resolve,reject)=>{const id=String(++seq),timer=setTimeout(()=>reject(new Error('RPC timeout')),3000);pending.set(id,x=>{clearTimeout(timer);resolve(x);});ws.send(JSON.stringify({id,path,body:{protocol:10,...body}}));});
  const other=await rpc('/join',{room:host.room,password:''});assert.equal(other.ok,true);
  await rpc('/poll',{room:host.room,token:other.token,revision:other.revision});
  const waitPush=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('push timeout')),3000);const interval=setInterval(()=>{if(pushes.length){clearTimeout(timer);clearInterval(interval);resolve(pushes.shift());}},2);timer.unref();});
  const patch={sections:400,plants:[],removed:[],coins:5,toolChanges:[{fields:0,upserts:[{id:1,kind:'vacuum',owner:'new'}],removed:[]}],progressChanges:[{fields:0,upserts:[],removed:[],pulls:[],times:[{playerId:'a',seconds:9}]}]};
  assert.equal((await call('/host',{room:host.room,token:host.token,patch:JSON.stringify(patch)})).ok,true);
  const pushed=await waitPush;assert.equal(pushed.baseRevision,other.revision);const delta=JSON.parse(pushed.delta);assert.equal(delta.toolChanges[0].upserts.length,1);assert.equal(delta.progressChanges[0].times[0].seconds,9);assert.equal(delta.tools,undefined);assert.equal(delta.progress,undefined);
  const chunk=await rpc('/snapshot',{room:host.room,token:other.token,snapshotId:guest.snapshot.id,index:0});assert.equal(chunk.ok,true,'snapshot route unavailable over websocket');
  await call('/close',{room:host.room,token:other.token});const late=await call('/join',{room:host.room,password:''});const current=JSON.parse(late.world);assert.equal(current.tools.items[1].owner,'guest');assert.deepEqual(current.progress.players,[{playerId:'a',pulls:4,seconds:9}]);
  await call('/close',{room:host.room,token:host.token});assert.equal((await call('/snapshot',{room:host.room,token:guest.token,snapshotId:guest.snapshot.id,index:0})).ok,false);
 }finally{ws?.terminate();child.kill();}
});
