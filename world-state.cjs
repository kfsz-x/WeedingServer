const {applyBundleChanges}=require('./bundle-state.cjs');
const {applyToolChanges,applyProgressChanges}=require('./tool-progress-state.cjs');

function areaState(value){
 if(!value)return null;
 const {areas=[],...header}=value,records=new Map();
 for(const area of areas){
  if(records.has(area.areaId))throw new Error('区域基线重复');
  const {pulledIds=[],...metadata}=area;
  records.set(area.areaId,{metadata,ids:new Set(pulledIds)});
 }
 return {header,records};
}
function prepareAreaChanges(state,changes){
 if(!state||!Array.isArray(changes))throw new Error('缺少区域同步基线');
 const jobs=[];
 for(const change of changes){
  if(!state.records.has(change.currentArea)||!Number.isSafeInteger(change.uniquePulls)||change.uniquePulls<0)throw new Error('区域同步基线不匹配');
  const records=[];
  for(const update of change.changes||[]){
   const record=state.records.get(update.areaId);
   if(!record||!Number.isSafeInteger(update.plantCount)||update.plantCount<0)throw new Error('区域同步基线不匹配');
   for(const id of [...(update.added||[]),...(update.removed||[])])
    if(!Number.isSafeInteger(id)||id<0||id>=update.plantCount)throw new Error('无效拔草ID');
   records.push({record,update});
  }
  jobs.push({change,records});
 }
 return jobs;
}

class RoomWorld {
 constructor(json){
  this.data=JSON.parse(json);
  this.plants=new Map((this.data.plants||[]).map(p=>[p.id,p]));delete this.data.plants;
  this.areas=areaState(this.data.areas);delete this.data.areas;
  this.serialized=json;
 }
 matches(json){return this.serialized===json;}
 apply(patch){
  // All operations that can reject a patch are prepared before committed state changes.
  let bundles=patch.bundles||this.data.bundles;
  if((patch.sections&32)!==0)bundles=applyBundleChanges(bundles,patch.bundleChanges||[]);
  const areas=patch.areas?areaState(patch.areas):this.areas;
  const areaJobs=(patch.sections&64)!==0?prepareAreaChanges(areas,patch.areaChanges):[];
  let tools=patch.tools||this.data.tools,progress=patch.progress||this.data.progress;
  if((patch.sections&128)!==0)tools=applyToolChanges(tools,patch.toolChanges);
  if((patch.sections&256)!==0)progress=applyProgressChanges(progress,patch.progressChanges);
  let economy=this.data.economy;
  if((patch.sections&512)!==0){
   economy=patch.economy;
   if(!economy||typeof economy.shared!=='boolean'||!Array.isArray(economy.wallets)||economy.wallets.length>4)throw Error('无效经济状态');
   const actors=new Set();for(const w of economy.wallets){if(!w||typeof w.actor!=='string'||!w.actor||actors.has(w.actor)||!Number.isSafeInteger(w.coins)||w.coins<0||w.coins>2147483647)throw Error('无效钱包');actors.add(w.actor);}
   if(!actors.has('host'))throw Error('缺少房主钱包');
  }
  const removed=patch.removed||[],plants=patch.plants||[];
  if(!Array.isArray(removed)||!Array.isArray(plants))throw new Error('无效植物增量');
  for(const id of removed)if(!Number.isSafeInteger(id)||id<0)throw new Error('无效植物ID');
  for(const plant of plants)if(!plant||!Number.isSafeInteger(plant.id)||plant.id<0)throw new Error('无效植物记录');
  for(const id of removed)this.plants.delete(id);
  for(const plant of plants)this.plants.set(plant.id,plant);
  this.data.coins=patch.coins;this.data.expanded=patch.expanded;this.data.goldFinger=patch.goldFinger;
  if(Number.isInteger(patch.merchantSaleSequence)){this.data.merchantSaleSequence=patch.merchantSaleSequence;this.data.merchantSales=patch.merchantSales||[];}
  if(tools)this.data.tools=tools;if(progress)this.data.progress=progress;
  if(bundles)this.data.bundles=bundles;
  if(economy)this.data.economy=economy;
  this.areas=areas;
  for(const {change,records} of areaJobs){
   areas.header.currentArea=change.currentArea;areas.header.uniquePulls=change.uniquePulls;
   for(const {record,update} of records){
    for(const id of update.removed||[])record.ids.delete(id);
    for(const id of update.added||[])record.ids.add(id);
    Object.assign(record.metadata,{plantCount:update.plantCount,initialized:update.initialized,metadataOnly:update.metadataOnly,sparsePlants:update.sparsePlants});
   }
  }
  if(patch.contentVersion>=2){this.data.contentVersion=patch.contentVersion;this.data.plantCount=patch.plantCount;this.data.sparsePlants=!!patch.sparsePlants;}
  if(patch.gardenLayoutVersion>0)this.data.gardenLayoutVersion=patch.gardenLayoutVersion;
  this.serialized=null;
 }
 snapshot(){
  if(this.serialized===null){
   const world={...this.data,plants:[...this.plants.values()]};
   if(this.areas)world.areas={...this.areas.header,areas:[...this.areas.records.values()].map(({metadata,ids})=>({...metadata,pulledIds:[...ids].sort((a,b)=>a-b)}))};
   this.serialized=JSON.stringify(world);
  }
  return this.serialized;
 }
}
module.exports={RoomWorld};
