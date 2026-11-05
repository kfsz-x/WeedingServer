'use strict';
const {WebSocketServer,WebSocket}=require('ws');
const ROUTES=new Set(['/address','/create','/join','/host','/poll','/command','/kick','/close','/client-log','/snapshot']);
// Reuse the HTTP handler, including its authentication, without renewing host leases.
function attach(server,{authorizeSubscription=()=>false,maxPayload=16*1024*1024}={}) {
 const wss=new WebSocketServer({noServer:true,maxPayload,perMessageDeflate:false});
 const dispatch=(socket,path,body,internalRoomPush=false)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Request timed out')),10000);timer.unref();
  const req={method:'POST',url:path,socket:socket._socket,internalRoomPush,async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
  const res={statusCode:200,setHeader(){},writeHead(status){this.statusCode=status;},end(body){clearTimeout(timer);resolve({status:this.statusCode,body:String(body||'')});}};
  try{server.emit('request',req,res);}catch(e){clearTimeout(timer);reject(e);}
 });
 function send(socket,message){if(socket.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount>maxPayload){socket.close(1013,'Backpressure');return;}socket.send(JSON.stringify(message));}
 function upgrade(req,socket,head){if(req.url!=='/room-ws'){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));}
 server.on('upgrade',upgrade);
 wss.on('connection',socket=>{
  socket.pending=0;socket.subscription=null;socket.pushBusy=false;socket.pushAgain=false;
  socket.on('error',()=>{});
  socket.on('close',()=>{socket.subscription=null;});
  socket.on('message',async(raw,binary)=>{
   let msg;try{msg=JSON.parse(raw.toString());if(binary||!msg||typeof msg.id!=='string'||msg.id.length>80||!ROUTES.has(msg.path)||!msg.body||typeof msg.body!=='object')throw Error('Invalid request');}catch(e){send(socket,{type:'response',id:msg&&msg.id,status:400,body:JSON.stringify({ok:false,error:'Invalid request'})});return;}
   if(socket.pending>=8){socket.close(1013,'Too many requests');return;}socket.pending++;
   try{const reply=await dispatch(socket,msg.path,msg.body);send(socket,{type:'response',id:msg.id,...reply});
    if(msg.path==='/poll'){const result=JSON.parse(reply.body);if(result.ok&&authorizeSubscription(msg.body.room,msg.body.token))socket.subscription={...msg.body,revision:result.revision};else socket.subscription=null;}
    if(['/join','/create','/close'].includes(msg.path))socket.subscription=null;
   }catch(e){send(socket,{type:'response',id:msg.id,status:500,body:JSON.stringify({ok:false,error:'Request failed'})});}finally{socket.pending--;}
  });
 });
 async function push(socket){if(socket.pushBusy){socket.pushAgain=true;return;}socket.pushBusy=true;
  try{do{socket.pushAgain=false;const sub=socket.subscription;if(!sub||!authorizeSubscription(sub.room,sub.token)){socket.subscription=null;return;}
   const reply=await dispatch(socket,'/poll',sub,true);if(socket.subscription!==sub)return;const result=JSON.parse(reply.body);
   if(!result.ok){socket.subscription=null;send(socket,{type:'push',...reply});return;}
   if(result.revision!==sub.revision){sub.revision=result.revision;send(socket,{type:'push',...reply});}
  }while(socket.pushAgain&&socket.readyState===WebSocket.OPEN);}catch(e){socket.close(1011,'Push failed');}finally{socket.pushBusy=false;}
 }
 const updated=room=>{for(const socket of wss.clients)if(socket.subscription&&socket.subscription.room===room)void push(socket);};
 server.on('room-updated',updated);
 const shutdown=()=>{for(const socket of wss.clients)send(socket,{type:'push',status:200,body:JSON.stringify({ok:false,code:'SERVER_SHUTDOWN',error:'服务器已关闭，已返回离线模式'})});};
 const stop=()=>{for(const socket of wss.clients)socket.close(1001,'Server shutdown');};
 server.on('server-shutdown',shutdown);server.on('shutdown-sockets',stop);
 return {close(){server.off('server-shutdown',shutdown);server.off('shutdown-sockets',stop);server.off('upgrade',upgrade);server.off('room-updated',updated);for(const socket of wss.clients)socket.terminate();wss.close();}};
}
module.exports={attach};
