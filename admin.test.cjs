const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),crypto=require('node:crypto'),{WebSocket}=require('ws');
const {RoomTraffic}=require('./room-traffic.cjs');
const {createAdmin}=require('./admin.cjs');
test('admin without configured secret remains disabled',async()=>{let result;const res={statusCode:0,setHeader(){},end(value){result=JSON.parse(value);}};await createAdmin({token:'',state:()=>({rooms:[]})})({url:'/admin/api/rooms',method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},res);assert.equal(res.statusCode,503);assert.equal(result.ok,false);});
test('traffic totals and rolling rates expire idle samples',()=>{
 const t=new RoomTraffic();t.add(100,200,1000);t.add(50,100,2000);
 assert.deepEqual(t.snapshot(3000),{receivedBytes:150,sentBytes:300,receivedBytesPerSecond:30,sentBytesPerSecond:60});
 assert.equal(t.snapshot(9000).sentBytesPerSecond,0);assert.equal(t.snapshot(9000).sentBytes,300);
});
test('admin auth, byte accounting, targeted kick and room closure',async()=>{
 const secret='test-only-admin-secret-not-for-deployment-123456789';
 const child=spawn(process.execPath,[require.resolve('./server.cjs')],{env:{...process.env,WEEDING_PORT:'18799',WEEDING_ADMIN_TOKEN:secret},stdio:['ignore','pipe','pipe']});let ws;
 try{
  await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('exit '+c)));});const base='http://127.0.0.1:18799';
  const malformed=await fetch(base+'/poll',{method:'POST',body:'null'});assert.equal((await malformed.json()).code,'INVALID_REQUEST');assert.equal((await fetch(base+'/health')).status,200);
  const game=async(path,body)=>{const r=await fetch(base+path,{method:'POST',body:JSON.stringify({protocol:10,...body})});return r.json();};
  const page=await fetch(base+'/admin');assert.equal(page.status,200);assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"));assert.ok((await page.text()).includes('房间管理'));
  assert.equal((await fetch(base+'/admin/api/rooms')).status,401);
  assert.equal((await fetch(base+'/admin/api/login',{method:'POST',body:'{"token":"bad"}'})).status,401);
  let r=await fetch(base+'/admin/api/login',{method:'POST',headers:{Origin:base},body:JSON.stringify({token:secret})});assert.equal(r.status,200);const session=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0];assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));
  const headers={Cookie:cookie,Origin:base,'X-Admin-CSRF':session.csrf};const admin=async(path,body)=>{const r=await fetch(base+'/admin/api/'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const salt=Buffer.alloc(16).toString('base64'),hash=crypto.pbkdf2Sync('',Buffer.from(salt,'base64'),10000,32,'sha1').toString('base64');
  const h=await game('/create',{salt,hash,world:'{"plants":[]}',playerId:'fixture-host'}),g=await game('/join',{room:h.room,playerId:'fixture-guest'});assert.equal(g.ok,true);
  let list=(await admin('rooms')).body;let room=list.rooms.find(x=>x.code===h.room);assert.equal(room.host.playerId,'fixture-host');assert.equal(room.guests[0].id,g.self);assert.ok(room.createdAt<=Date.now());assert.ok(room.traffic.receivedBytes>0);assert.equal(JSON.stringify(list).includes(h.token),false);assert.equal(JSON.stringify(list).includes(g.token),false);
  ws=new WebSocket('ws://127.0.0.1:18799/room-ws');await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const before=room.traffic;const rpc=JSON.stringify({id:'admin-probe',path:'/poll',body:{protocol:10,room:h.room,token:g.token,revision:1}});
  const response=new Promise(resolve=>ws.once('message',raw=>resolve(raw)));ws.send(rpc);const raw=await response;
  room=(await admin('rooms')).body.rooms.find(x=>x.code===h.room);assert.equal(room.traffic.receivedBytes-before.receivedBytes,Buffer.byteLength(rpc));assert.equal(room.traffic.sentBytes-before.sentBytes,raw.length,'WebSocket virtual HTTP counted twice');
  r=await fetch(base+'/admin/api/rooms/'+h.room+'/kick',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({actor:g.self})});assert.equal(r.status,403);
  assert.equal((await admin('rooms/'+h.room+'/close',{createdAt:room.createdAt-1})).status,404);
  const notice=new Promise(resolve=>ws.once('message',raw=>resolve(JSON.parse(raw))));assert.equal((await admin('rooms/'+h.room+'/kick',{actor:g.self,createdAt:room.createdAt})).status,200);assert.equal(JSON.parse((await notice).body).code,'SESSION_ENDED');
  assert.equal((await game('/poll',{room:h.room,token:g.token})).code,'SESSION_ENDED');assert.equal((await game('/host',{room:h.room,token:h.token})).ok,true);
  assert.equal((await admin('rooms/'+h.room+'/close',{createdAt:room.createdAt})).status,200);assert.equal((await game('/host',{room:h.room,token:h.token})).code,'SESSION_ENDED');
  assert.equal((await admin('rooms')).body.rooms.some(x=>x.code===h.room),false);
  assert.equal((await admin('logout',{})).status,200);assert.equal((await fetch(base+'/admin/api/rooms',{headers:{Cookie:cookie}})).status,401);
 }finally{ws?.terminate();child.kill();}
});
