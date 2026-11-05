const {test}=require('node:test');const assert=require('node:assert/strict');const {RoomWorld}=require('./world-state.cjs');
test('tool object and player time deltas retain unrelated values',()=>{
 const state=new RoomWorld(JSON.stringify({plants:[],tools:{gloveLevel:2,items:[{id:1,kind:'vacuum',owner:'a'},{id:2,kind:'mower',owner:'b'}]},progress:{exitUnlocked:true,settled:false,players:[{playerId:'a',pulls:10,seconds:1},{playerId:'b',pulls:20,seconds:2}]}}));
 state.apply({sections:400,coins:0,plants:[],removed:[],toolChanges:[{fields:0,upserts:[{id:1,kind:'vacuum',owner:'c'}],removed:[]}],progressChanges:[{fields:0,upserts:[],removed:[],pulls:[],times:[{playerId:'a',seconds:9}]}]});
 const world=JSON.parse(state.snapshot());assert.equal(world.tools.items[0].owner,'c');assert.equal(world.tools.items[1].owner,'b');assert.equal(world.tools.gloveLevel,2);assert.deepEqual(world.progress.players,[{playerId:'a',pulls:10,seconds:9},{playerId:'b',pulls:20,seconds:2}]);assert.equal(world.progress.exitUnlocked,true);
});
test('patches never traverse large initial layout and snapshots are lazy revision caches',()=>{
 const state=new RoomWorld(JSON.stringify({plants:[{id:1,state:0}],plantData:{plants:Array.from({length:10000},(_,id)=>({id}))},areas:{currentArea:0,uniquePulls:0,areas:[{areaId:0,plantCount:10010,pulledIds:[],plants:[]}]}}));
 const layout=state.data.plantData;let layoutReads=0;
 Object.defineProperty(state.data,'plantData',{enumerable:true,get(){layoutReads++;return layout;}});
 const patch={sections:80,coins:1,plants:[{id:2,state:1}],removed:[1],areaChanges:[{currentArea:0,uniquePulls:1,changes:[{areaId:0,plantCount:10010,initialized:true,metadataOnly:true,sparsePlants:true,added:[2],removed:[]}]}]};
 for(let i=0;i<20;i++)state.apply({...patch,coins:i});
 assert.equal(layoutReads,0,'ordinary patches touched the full initial layout');
 const first=state.snapshot(),second=state.snapshot();assert.equal(first,second);assert.equal(layoutReads,1,'full snapshot was rebuilt for each reader');
 const world=JSON.parse(first);assert.deepEqual(world.plants,[{id:2,state:1}]);assert.deepEqual(world.areas.areas[0].pulledIds,[2]);assert.equal(world.coins,19);assert.equal(world.plantData.plants.length,10000);
 assert.throws(()=>state.apply({...patch,coins:999,areaChanges:[{...patch.areaChanges[0],changes:[{...patch.areaChanges[0].changes[0],areaId:99}]}]}));
 assert.equal(state.snapshot(),first,'failed patch invalidated or modified a committed snapshot');assert.equal(layoutReads,1);
 assert.throws(()=>state.apply({...patch,removed:[2],plants:[null]}));assert.equal(state.snapshot(),first,'invalid plant deleted committed data before failure');
 state.apply({...patch,coins:20});const third=state.snapshot();assert.equal(JSON.parse(third).coins,20);assert.equal(layoutReads,2,'cache was not invalidated on a real update');
});
