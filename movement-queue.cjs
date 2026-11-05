'use strict';
const grassActions = new Set(['pull','move','drop','collect','sell','eject']);
function enqueueCommand(room,data,actor) {
  const areaId=data.areaId||0;
  const isGrass=grassActions.has(data.action);
  const same=c=>c.actor===actor && c.areaId===areaId && c.id===data.id && grassActions.has(c.action);
  // Positive sequences are ordered per plant; missing sequences preserve legacy behavior.
  if(isGrass && data.clientSequence>0 && room.commands.some(c=>same(c) && c.clientSequence>0 && c.clientSequence>=data.clientSequence))return false;
  const obsolete=isGrass ? room.commands.filter(c=>same(c) && c.action==='move') : [];
  if(room.commands.length-obsolete.length>=256)throw new Error('操作队列繁忙，请稍后重试');
  if(obsolete.length)room.commands=room.commands.filter(c=>!obsolete.includes(c));
  room.commands.push({action:data.action,id:data.id,actor,areaId,plant:data.plant,
    clientSequence:data.clientSequence,sequence:++room.commandSequence});
  return true;
}
module.exports={enqueueCommand};
