'use strict';
const $=id=>document.getElementById(id);let csrf='',data=null,inFlight=false,pendingAction=null,actionBusy=false;
const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
const number=value=>Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:1});
function bytes(value){let n=Number(value||0),unit=0;const units=['B','KiB','MiB','GiB','TiB'];while(n>=1024&&unit<units.length-1){n/=1024;unit++;}return number(n)+' '+units[unit];}
function rate(value){const bits=Number(value||0)*8;return bits>=1000000?number(bits/1000000)+' Mbps':bits>=1000?number(bits/1000)+' Kbps':Math.round(bits)+' bps';}
function duration(seconds){const s=Math.max(0,Math.floor(seconds||0));return s>=3600?Math.floor(s/3600)+'小时 '+Math.floor(s%3600/60)+'分':s>=60?Math.floor(s/60)+'分 '+s%60+'秒':s+'秒';}
function date(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
function message(text){$('message').textContent=text;$('message').hidden=!text;}
async function api(path,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const response=await fetch('/admin/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-Admin-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});let value;try{value=await response.json();}catch{throw Error('服务器没有返回有效数据');}if(!response.ok||!value.ok){const e=Error(value.error||'请求失败');e.status=response.status;throw e;}return value;}finally{clearTimeout(timer);}
}
function locked(text){if($('confirm-dialog').open)$('confirm-dialog').close();pendingAction=null;csrf='';data=null;$('overview').hidden=$('resource').hidden=$('room-panel').hidden=true;$('rooms').replaceChildren();$('overview').replaceChildren();$('resource').replaceChildren();$('logout').hidden=true;$('refresh').disabled=true;$('connection').className='connection';$('connection').textContent='尚未登录';$('login-error').textContent=text||'';if(!$('login-dialog').open)$('login-dialog').showModal();}
function metric(label,value,foot){const card=element('article','metric');card.append(element('div','metric-label',label),element('div','metric-value',value),element('div','metric-foot',foot));return card;}
function render(){
 if(!data)return;const s=data.server,all=data.rooms;const sent=all.reduce((n,r)=>n+r.traffic.sentBytesPerSecond,0),total=all.reduce((n,r)=>n+r.traffic.receivedBytes+r.traffic.sentBytes,0);
 $('overview').replaceChildren(metric('在线房间',number(all.length),'房间上限 '+s.limits.maxRooms),metric('在线玩家',number(s.players),'人数上限 '+s.limits.maxPlayers),metric('当前发送速率',rate(sent),'所有活动房间 · 5秒平均'),metric('累计消息流量',bytes(total),'当前活动房间接收 + 发送'));
 const resources=[['进程内存',number(s.metrics.rssMb)+' / '+s.limits.maxRssMb+' MiB'],['CPU（单核基准）',number(s.metrics.cpu)+'%'],['事件循环延迟',number(s.metrics.lagMs)+' ms']].map(([label,value])=>{const el=element('span','',label);el.append(element('strong','',value));return el;});resources.push(element('span','status'+(s.overloaded||s.shuttingDown?' warning':''),s.shuttingDown?'正在停服':s.overloaded?'资源繁忙，暂停新准入':'服务正常'));$('resource').replaceChildren(...resources);
 const query=$('search').value.trim().toLowerCase();const rooms=all.filter(r=>[r.code,'o-'+r.code,'l-'+r.code,r.host.playerId,...r.guests.flatMap(g=>[g.id,g.playerId])].join(' ').toLowerCase().includes(query));$('room-count').textContent=all.length;
 if(!rooms.length){const empty=element('div','empty');empty.append(element('div','','◇'),element('strong','',query?'没有匹配的房间':'目前没有在线房间'),element('div','',query?'试试其他房间号或玩家编号。':'新房间建立后会自动出现在这里。'));$('rooms').replaceChildren(empty);}
 else $('rooms').replaceChildren(...rooms.map(roomCard));
 $('overview').hidden=$('resource').hidden=$('room-panel').hidden=false;
}
function playerRow(room,player,host){
 const row=element('div','player');const role=element('span','role'+(host?' host':''),host?'● 房主':'○ 客人'),name=element('div','player-name',player.playerId||player.id);name.title=player.playerId||player.id;name.append(element('small','',host?'房间权威 / 存档持有者':'会话编号 '+player.id));row.append(role,name,element('span','heartbeat','心跳 '+duration(player.heartbeatAgeMs/1000)+'前'));
 if(!host){const button=element('button','danger-text','踢出');button.type='button';button.disabled=actionBusy;button.addEventListener('click',()=>confirmAction('kick',room,player));row.append(button);}else row.append(element('span'));return row;
}
function roomCard(room){
 const card=element('article','room'),top=element('div','room-top'),left=element('div'),heading=element('div','room-heading');heading.append(element('span','room-dot'),element('span','room-id',(data.server.networkMode==='online'?'O-':'L-')+room.code));const tags=element('div','room-tags');tags.append(element('span','tag',room.economyShared?'共享经济':'独立经济'));heading.append(tags);left.append(heading,element('div','room-meta','建立于 '+date(room.createdAt)));const actions=element('div','room-actions');actions.append(element('span','','已运行 '+duration(room.ageSeconds)+' · '+(1+room.guests.length)+' / 4 人'));const close=element('button','danger-text','关闭房间');close.type='button';close.disabled=actionBusy;close.addEventListener('click',()=>confirmAction('close',room));actions.append(close);top.append(left,actions);
 const usage=element('div','usage'),t=room.traffic;for(const [label,value,accent] of [['发送速率',rate(t.sentBytesPerSecond),true],['接收速率',rate(t.receivedBytesPerSecond),false],['累计发送',bytes(t.sentBytes),false],['累计接收',bytes(t.receivedBytes),false]]){const block=element('div');block.append(element('div','usage-label',label),element('div','usage-number'+(accent?' accent':''),value));usage.append(block);}
 const players=element('div','players');players.append(playerRow(room,room.host,true),...room.guests.map(g=>playerRow(room,g,false)));card.append(top,usage,players);return card;
}
async function refresh(){
 if(inFlight||!csrf)return;inFlight=true;$('refresh').disabled=true;
 try{data=await api('rooms');render();message('');$('connection').textContent='实时连接';$('connection').className='connection live';$('updated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false});}
 catch(e){if(e.status===401)locked('会话已过期，请重新登录');else{message(e.name==='AbortError'?'刷新超时，请检查服务连接':e.message);$('connection').textContent='连接异常';$('connection').className='connection';}}
 finally{inFlight=false;$('refresh').disabled=!csrf;}
}
function confirmAction(kind,room,player){if(actionBusy)return;pendingAction={kind,room,player};$('confirm-title').textContent=kind==='kick'?'踢出这位客人？':'关闭这个房间？';$('confirm-detail').textContent=kind==='kick'?'房间 '+room.code+'，客人 '+(player.playerId||player.id)+' 将返回离线模式；独立钱包余额由房主结转。':'房间 '+room.code+' 的 '+(1+room.guests.length)+' 位玩家将全部结束联机，返回各自离线游戏。此操作不能撤销。';$('confirm-error').textContent='';$('confirm-action').textContent=kind==='kick'?'确认踢出':'确认关闭房间';$('confirm-dialog').showModal();}
$('confirm-form').addEventListener('submit',async event=>{event.preventDefault();if(!pendingAction||actionBusy)return;actionBusy=true;$('confirm-action').disabled=true;$('cancel-action').disabled=true;const {kind,room,player}=pendingAction;try{await api('rooms/'+room.code+'/'+kind,{actor:player?.id,createdAt:room.createdAt});$('confirm-dialog').close();pendingAction=null;await refresh();}catch(e){$('confirm-error').textContent=e.message;}finally{actionBusy=false;$('confirm-action').disabled=false;$('cancel-action').disabled=false;render();}});
$('cancel-action').addEventListener('click',()=>{if(!actionBusy){$('confirm-dialog').close();pendingAction=null;}});
$('confirm-dialog').addEventListener('cancel',event=>{if(actionBusy)event.preventDefault();else pendingAction=null;});
$('login-dialog').addEventListener('cancel',event=>event.preventDefault());
$('login-form').addEventListener('submit',async event=>{event.preventDefault();$('login-submit').disabled=true;$('login-error').textContent='';try{const session=await api('login',{token:$('admin-token').value});csrf=session.csrf;$('login-dialog').close();$('logout').hidden=false;await refresh();}catch(e){$('login-error').textContent=e.name==='AbortError'?'连接超时，请重试':e.message;}finally{$('admin-token').value='';$('login-submit').disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('logout',{});locked();message('');}catch(e){message('退出未完成：'+e.message);}});
$('refresh').addEventListener('click',refresh);$('search').addEventListener('input',render);
setInterval(()=>{if(!document.hidden)refresh();},3000);
(async()=>{try{const session=await api('session');csrf=session.csrf;$('logout').hidden=false;await refresh();}catch(e){locked(e.status===401?'':e.message);}})();
