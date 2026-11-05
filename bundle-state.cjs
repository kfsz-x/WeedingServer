// Only authority data is handled here. Pose records deliberately have no contents.
function applyBundleChanges(state, changes) {
 if(!state)throw new Error('缺少草袋同步基线');
 const items=new Map((state.items||[]).map(item=>[item.id,item]));
 const carried=new Map((state.carriedGrass||[]).map(item=>[item.id,item]));
 const settled=new Set(state.settledPlants||[]);
 let nextId=state.nextId;
 for(const change of changes){
  for(const id of change.removed||[])items.delete(id);
  for(const item of change.upserts||[])items.set(item.id,item);
  for(const pose of change.poses||[]){
   const item=items.get(pose.id);if(!item)throw new Error('草袋同步基线不匹配');
   items.set(pose.id,{...item,areaId:pose.areaId,owner:pose.owner,position:pose.position,rotation:pose.rotation,velocity:pose.velocity,flying:pose.flying});
  }
  for(const id of change.carriedRemoved||[])carried.delete(id);
  for(const item of change.carriedUpserts||[])carried.set(item.id,item);
  for(const id of change.settledRemoved||[])settled.delete(id);
  for(const id of change.settledAdded||[])settled.add(id);
  nextId=change.nextId;
 }
 return {nextId,items:[...items.values()],carriedGrass:[...carried.values()],settledPlants:[...settled].sort()};
}
module.exports={applyBundleChanges};
