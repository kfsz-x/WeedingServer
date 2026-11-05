const {test}=require('node:test');const assert=require('node:assert/strict');
const {CapacityGuard}=require('./capacity.cjs');
test('room/player ceilings only block appropriate new admission',()=>{
 const g=new CapacityGuard({maxRooms:1,maxPlayers:4,maxRssMb:512,maxCpu:85,maxLagMs:100});
 assert.equal(g.reason('create',1,1),'ROOM_LIMIT');assert.equal(g.reason('join',1,3),null);
 assert.equal(g.reason('join',1,4),'PLAYER_LIMIT');assert.equal(g.reason('create',0,0),null);
});
test('sustained pressure gates both entry paths; recovery has hysteresis',()=>{
 const g=new CapacityGuard({maxRooms:5,maxPlayers:20,maxRssMb:512,maxCpu:85,maxLagMs:100});
 for(let i=0;i<2;i++)g.sample({rssMb:600,cpu:0,lagMs:0});assert.equal(g.reason('join',1,1),null);
 g.sample({rssMb:600,cpu:0,lagMs:0});assert.equal(g.reason('join',1,1),'RESOURCE_LIMIT');
 for(let i=0;i<4;i++)g.sample({rssMb:10,cpu:0,lagMs:0});assert.equal(g.reason('create',0,0),'RESOURCE_LIMIT');
 g.sample({rssMb:10,cpu:0,lagMs:0});assert.equal(g.reason('create',0,0),null);
});
test('CPU and event-loop saturation trigger gate; invalid configuration fails',()=>{
 for(const sample of [{rssMb:1,cpu:90,lagMs:0},{rssMb:1,cpu:0,lagMs:101}]){
  const g=new CapacityGuard();for(let i=0;i<3;i++)g.sample(sample);assert.equal(g.reason('join',0,0),'RESOURCE_LIMIT');
 }
 assert.throws(()=>new CapacityGuard({maxRooms:-1}));assert.throws(()=>new CapacityGuard({maxPlayers:NaN}));
});
