const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),crypto=require('node:crypto'),{WebSocket}=require('ws');
test('online admission, mode isolation, existing session continuity and shutdown notification',async()=>{
 const child=spawn(process.execPath,['-e',"const s=require('./server.cjs');process.on('message',()=>s.beginShutdown());"],{cwd:__dirname,env:{...process.env,WEEDING_MODE:'online',WEEDING_PORT:'18797',WEEDING_MAX_ROOMS:'1',WEEDING_MAX_PLAYERS:'2'},stdio:['ignore','pipe','pipe','ipc']});let ws;
 try{
  await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('early exit '+c)));});
  const call=async(path,body)=>{let r=await fetch('http://127.0.0.1:18797'+path,{method:'POST',body:JSON.stringify({protocol:10,networkMode:'online',...body}),signal:AbortSignal.timeout(3000)});return r.json();};
  const salt=Buffer.alloc(16).toString('base64'),hash=crypto.pbkdf2Sync('',Buffer.from(salt,'base64'),10000,32,'sha1').toString('base64'),body={salt,hash,world:'{"plants":[]}'};
  assert.equal((await call('/create',{...body,networkMode:'local'})).code,'MODE_MISMATCH');
  const h=await call('/create',body);assert.equal(h.ok,true);assert.equal(h.networkMode,'online');
  assert.equal((await call('/create',body)).code,'ROOM_LIMIT');
  const g=await call('/join',{room:h.room});assert.equal(g.ok,true);
  assert.equal((await call('/join',{room:h.room})).code,'PLAYER_LIMIT');
  assert.equal((await call('/host',{room:h.room,token:h.token})).ok,true);
  ws=new WebSocket('ws://127.0.0.1:18797/room-ws');await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const notice=new Promise((r,j)=>{const t=setTimeout(()=>j(Error('shutdown notice timeout')),2500);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='push'){clearTimeout(t);r(JSON.parse(m.body));}});});
  child.send('stop');assert.equal((await notice).code,'SERVER_SHUTDOWN');
  assert.equal((await call('/poll',{room:h.room,token:g.token})).code,'SERVER_SHUTDOWN');
  assert.equal((await call('/create',body)).code,'SERVER_SHUTDOWN');
 }finally{ws?.terminate();child.kill();}
});
