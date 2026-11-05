const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {RoomWorld}=require('./world-state.cjs');
const {SnapshotArchive}=require('./snapshot-transfer.cjs');
const {enqueueCommand}=require('./movement-queue.cjs');
const {attach}=require('./room-websocket.cjs');
const {decodeWorldInput}=require('./world-upload.cjs');
const snapshots=new SnapshotArchive();
const requestCounts = new Map();
const rooms = new Map();
const port = Number(process.env.WEEDING_PORT || 8788);
function key() { return crypto.randomBytes(24).toString('hex'); }
function failure(message) { throw new Error(message); }
function fullWorld(room,code,support){
 const world=room.state.snapshot();
 return support&&Buffer.byteLength(world)>65536?{snapshot:snapshots.describe(code,world,room.revision)}:{world};
}
function authorized(room, token) {
  if (!room || Date.now() - room.lastHost > 15000) failure('房主已离线');
  if (token !== room.host && !room.guests.has(token)) failure('房间身份无效');
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  requestCounts.set(req.url, (requestCounts.get(req.url) || 0) + 1);
  if(req.method==='GET' && req.url==='/diagnostics') {
    res.end(JSON.stringify({rooms:[...rooms].map(([code,room])=>({
      room:code,host:room.metrics||null,hostHeartbeatAgeMs:Date.now()-room.lastHost,
      guests:[...room.guests.values()].map(guest=>guest.metrics||null)
    }))}));return;
  }
  if(req.method==='GET' && req.url==='/health') {
    res.end(JSON.stringify({ok:true,protocol:10,rooms:rooms.size,requests:Object.fromEntries(requestCounts)}));return;
  }
  if(req.method==='GET' && req.url==='/debug.rpk') {
    const file=path.resolve(__dirname,'../../../VivoDebug/webgl_vivo/dist/com.application.demo.minigame.rpk');
    if(!fs.existsSync(file)){res.statusCode=404;res.end(JSON.stringify({ok:false,error:'调试包不存在'}));return;}
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition','attachment; filename="com.application.demo.minigame.rpk"');
    res.setHeader('Content-Length',fs.statSync(file).size);
    const stream=fs.createReadStream(file);
    res.on('close',()=>stream.destroy());
    stream.on('error',()=>res.destroy());
    stream.pipe(res);return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (req.method !== 'POST') failure('只支持 POST');
    const chunks=[];let bytes=0;
    for await (const chunk of req) {
      bytes+=chunk.length;
      if (bytes > 16 * 1024 * 1024) failure('请求过大');
      chunks.push(chunk);
    }
    const raw=Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(raw);
    let room = rooms.get(data.room);
    let result = {};
    switch (req.url) {
      case '/client-log':
        console.log('[CLIENT_ERROR]', JSON.stringify({ip:req.socket.remoteAddress,stage:String(data.stage||'').slice(0,80),message:String(data.message||'').slice(0,12000)}));
        break;
      case '/address':
        result.ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        break;
      case '/create': {
        if(data.protocol!==10)failure('游戏版本不匹配，请更新游戏后重新开房（房间协议10）');
        let code;
        do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
        room = { host: key(), playerId:String(data.playerId||'host').slice(0,64),activeSeconds:0,salt: data.salt, hash: data.hash, guests: new Map(), pose: null,
          state:new RoomWorld(decodeWorldInput(data)), revision:1, history:[], commandSequence:0, commandKeys:new Set(), commands: [], lastHost: Date.now() };
        rooms.set(code, room);
        result = { room: code, token: room.host };
        break;
      }
      case '/join': {
        if(data.protocol!==10)failure('游戏版本不匹配，请更新游戏后加入房间（房间协议10）');
        if (!room || Date.now() - room.lastHost > 15000) failure('房间不存在或房主已离线');
        if (room.guests.size >= 3) failure('房间已满');
        const hash = crypto.pbkdf2Sync(data.password || '', Buffer.from(room.salt, 'base64'), 10000, 32, 'sha1');
        if (!crypto.timingSafeEqual(hash, Buffer.from(room.hash, 'base64'))) failure('密码错误');
        const worldReply=fullWorld(room,data.room,data.snapshotSupport);
        const token = key(); room.guests.set(token, { id: key().slice(0,8), playerId:String(data.playerId||key()).slice(0,64),activeSeconds:0,seen: Date.now(), pose: null });
        result = { room: data.room, token, self:room.guests.get(token).id, ...worldReply, revision:room.revision };
        break;
      }
      case '/snapshot':
        authorized(room,data.token);
        if(room.guests.has(data.token))room.guests.get(data.token).seen=Date.now();
        result=snapshots.chunk(data.room,data.snapshotId,data.index);break;
      case '/host':
        authorized(room, data.token);
        if (data.token !== room.host) failure('仅房主可发布状态');
        room.lastHost = Date.now(); room.pose = data.pose;
        if(Number.isFinite(data.activeSeconds) && data.activeSeconds>=0)room.activeSeconds=Math.max(room.activeSeconds,data.activeSeconds);
        room.metrics={device:data.device,ip:req.socket.remoteAddress,fps:data.fps,latency:data.latency,failures:data.failures,requests:data.requests};
        {
          const incomingWorld=decodeWorldInput(data);
          const replaced=incomingWorld&&!room.state.matches(incomingWorld);
          const next=replaced?new RoomWorld(incomingWorld):room.state;
          const patch=data.patch?JSON.parse(data.patch):null;
          if(patch)next.apply(patch);
          if(replaced){room.state=next;room.revision++;room.history=[];}
          if(patch){room.revision++;room.history.push({revision:room.revision,patch});if(room.history.length>64)room.history.shift();}
          if(replaced||patch)queueMicrotask(()=>server.emit('room-updated',data.room));
        }
        room.commands=room.commands.filter(command=>command.sequence>(data.ack||0));
        result.commands = room.commands;
        break;
      case '/poll':
        authorized(room, data.token);
        if(!req.internalRoomPush&&room.guests.has(data.token)){const guest=room.guests.get(data.token);guest.seen=Date.now();guest.pose=data.pose;if(Number.isFinite(data.activeSeconds) && data.activeSeconds>=0)guest.activeSeconds=Math.max(guest.activeSeconds,data.activeSeconds);guest.metrics={device:data.device,ip:req.socket.remoteAddress,fps:data.fps,latency:data.latency,failures:data.failures,requests:data.requests};}
        if(data.revision!==room.revision){
          const changes=room.history.filter(entry=>entry.revision>data.revision);
          if(changes.length && changes[0].revision===data.revision+1){
            const plants=new Map(),removed=new Set(),sections={},bundleChanges=[],areaChanges=[],toolChanges=[],progressChanges=[];let sectionMask=0;
            for(const {patch} of changes){
              for(const id of patch.removed){removed.add(id);plants.delete(id);}
              for(const plant of patch.plants){plants.set(plant.id,plant);removed.delete(plant.id);}
              sectionMask|=patch.sections||0;
              // Omitted sections mean unchanged. Keep the last supplied value of
              // each section across the entire gap, including explicit empty lists.
              for(const name of ['bundles','progress','tools','areas'])
                if(patch[name]!=null)sections[name]=patch[name];
              // A full inventory is a fresh baseline. Earlier changes are already
              // represented by it; later content and pose operations stay ordered.
              if(patch.bundles!=null){bundleChanges.length=0;sectionMask&=~32;}
              if((patch.sections&32)!==0){bundleChanges.push(...(patch.bundleChanges||[]));sectionMask|=32;}
              if(patch.areas!=null){areaChanges.length=0;sectionMask&=~64;}
              if((patch.sections&64)!==0){areaChanges.push(...(patch.areaChanges||[]));sectionMask|=64;}
              if(patch.tools!=null){toolChanges.length=0;sectionMask&=~128;}
              if((patch.sections&128)!==0){toolChanges.push(...(patch.toolChanges||[]));sectionMask|=128;}
              if(patch.progress!=null){progressChanges.length=0;sectionMask&=~256;}
              if((patch.sections&256)!==0){progressChanges.push(...(patch.progressChanges||[]));sectionMask|=256;}
            }
            const latest=changes[changes.length-1].patch;
            result.delta=JSON.stringify({sections:sectionMask,contentVersion:latest.contentVersion,plantCount:latest.plantCount,gardenLayoutVersion:latest.gardenLayoutVersion,sparsePlants:latest.sparsePlants,...sections,...(bundleChanges.length?{bundleChanges}:{}),...(areaChanges.length?{areaChanges}:{}),...(toolChanges.length?{toolChanges}:{}),...(progressChanges.length?{progressChanges}:{}),merchantSaleSequence:latest.merchantSaleSequence,merchantSales:latest.merchantSales,coins:latest.coins,expanded:latest.expanded,goldFinger:latest.goldFinger,plants:[...plants.values()],removed:[...removed]});
          }else Object.assign(result,fullWorld(room,data.room,data.snapshotSupport));
        }
        result.revision=room.revision;result.baseRevision=data.revision;break;
      case '/command':
        authorized(room, data.token);
        const toolActions=['tool:pickup','tool:equip','tool:stow','tool:drop','tool:use','tool:buy:bag','tool:buy:bag_small','tool:buy:bag_large','tool:buy:sprint','tool:buy:glove_gold','tool:buy:glove_rainbow','tool:buy:shovel_mini','tool:buy:shovel','tool:buy:vacuum','tool:buy:mower'];
        const bundleActions=['bundle:pack','bundle:pickup','bundle:drop','bundle:throw'];
        if (!['pull', 'move', 'drop', 'collect', 'sell', 'eject',...toolActions,...bundleActions].includes(data.action) || !Number.isInteger(data.id)) failure('无效操作');
        if(data.plant && (!data.plant.position || !data.plant.rotation ||
          !['x','y','z'].every(k=>Number.isFinite(data.plant.position[k])) ||
          !['x','y','z','w'].every(k=>Number.isFinite(data.plant.rotation[k])))) failure('无效植物坐标');
        const commandKey=data.token+':'+data.commandId;
        if(!data.commandId)failure('缺少操作编号，请更新客户端');
        if(!room.commandKeys.has(commandKey)){
          const actor=room.guests.get(data.token)?.id || 'host';
          enqueueCommand(room,data,actor);
          room.commandKeys.add(commandKey);
        }
        break;
      case '/kick':
        authorized(room, data.token);
        if(data.token!==room.host)failure('仅房主可踢出玩家');
        const target=[...room.guests].find(([,guest])=>guest.id===data.target);
        if(!target)failure('玩家已离开');
        room.guests.delete(target[0]);
        room.commands=room.commands.filter(command=>command.actor!==data.target);
        break;
      case '/close':
        authorized(room, data.token);
        if (data.token === room.host){rooms.delete(data.room);snapshots.drop(data.room);}
        else room.guests.delete(data.token);
        break;
      default: failure('未知接口');
    }
    if(room && ['/host','/poll'].includes(req.url)) {
      result.members=[{id:'host',host:true}];
      for(const guest of room.guests.values())if(Date.now()-guest.seen<15000)result.members.push({id:guest.id,host:false});
      result.peers=[];
      if(data.token!==room.host && room.pose)result.peers.push({id:'host',playerId:room.playerId,activeSeconds:room.activeSeconds,...room.pose});
      for(const [token,guest] of room.guests)
        if(token!==data.token && guest.pose && Date.now()-guest.seen<15000) result.peers.push({id:guest.id,playerId:guest.playerId,activeSeconds:guest.activeSeconds,...guest.pose});
    }
    if(['/create','/join','/close'].includes(req.url))console.log(new Date().toISOString(),req.socket.remoteAddress,req.url,'ok');
    res.end(JSON.stringify({ ok: true, protocol:10, ...result }));
  } catch (error) {
    console.log(new Date().toISOString(),req.socket.remoteAddress,req.url,error.message);
    // Game errors stay in JSON because some mini-game transports discard HTTP error bodies.
    res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});
server.listen(port, '0.0.0.0', () => console.log('Weeding LAN relay listening on ' + port));
if(process.env.WEEDING_DISABLE_WS!=='1')attach(server,{authorizeSubscription:(code,token)=>!!rooms.get(code)?.guests.has(token)});
setInterval(() => {
  for (const [code, room] of rooms) {
    if (Date.now() - room.lastHost > 15000){rooms.delete(code);snapshots.drop(code);}
    for(const [token,guest] of room.guests)if(Date.now()-guest.seen>15000)room.guests.delete(token);
  }
}, 5000).unref();
