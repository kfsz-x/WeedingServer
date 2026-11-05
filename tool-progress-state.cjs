// Apply ordered history without mutating the committed baseline.
function applyToolChanges(state,changes){
 if(!state||!Array.isArray(changes))throw new Error('缺少工具同步基线');
 const result={...state},items=new Map((state.items||[]).map(x=>[x.id,x]));
 for(const c of changes){
  if(c.fields&1)result.gloveLevel=c.gloveLevel;if(c.fields&2)result.bagLevel=c.bagLevel;
  if(c.fields&4)result.sprintUnlocked=c.sprintUnlocked;if(c.fields&8)result.nextItemId=c.nextItemId;
  for(const id of c.removed||[])items.delete(id);for(const x of c.upserts||[])items.set(x.id,{...x});
 }
 result.items=[...items.values()].sort((a,b)=>a.id-b.id);return result;
}
function applyProgressChanges(state,changes){
 if(!state||!Array.isArray(changes))throw new Error('缺少进度同步基线');
 const result={...state},players=new Map((state.players||[]).map(x=>[x.playerId,x]));
 for(const c of changes){
  if(c.fields&1)result.exitUnlocked=c.exitUnlocked;if(c.fields&2)result.settled=c.settled;
  for(const id of c.removed||[])players.delete(id);for(const x of c.upserts||[])players.set(x.playerId,{...x});
  for(const x of c.pulls||[]){const old=players.get(x.playerId);if(!old)throw new Error('进度同步基线不匹配');players.set(x.playerId,{...old,pulls:x.pulls});}
  for(const x of c.times||[]){const old=players.get(x.playerId);if(!old)throw new Error('进度同步基线不匹配');players.set(x.playerId,{...old,seconds:x.seconds});}
 }
 result.players=[...players.values()].sort((a,b)=>a.playerId<b.playerId?-1:a.playerId>b.playerId?1:0);return result;
}
module.exports={applyToolChanges,applyProgressChanges};
