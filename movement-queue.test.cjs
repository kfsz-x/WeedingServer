const test=require('node:test');
const assert=require('node:assert/strict');
const {enqueueCommand}=require('./movement-queue.cjs');
function room(){return {commands:[],commandSequence:0};}
function cmd(action,clientSequence,id=1,areaId=0){return {action,clientSequence,id,areaId};}
test('latest move replaces queued pose with monotonic ack ordering',()=>{
 const r=room();enqueueCommand(r,cmd('move',1),'a');enqueueCommand(r,cmd('tool:buy:bag',2),'a');enqueueCommand(r,cmd('move',3),'a');
 assert.deepEqual(r.commands.map(c=>[c.action,c.sequence]),[['tool:buy:bag',2],['move',3]]);
 assert.equal(r.commands[1].clientSequence,3);
 assert.equal(enqueueCommand(r,cmd('move',2),'a'),false);
 assert.equal(r.commandSequence,3);
});
test('critical grass action cancels its queued motion and prevents reordered move replacement',()=>{
 const r=room();enqueueCommand(r,cmd('move',1),'a');enqueueCommand(r,cmd('move',2),'b');enqueueCommand(r,cmd('move',3,1,1),'a');enqueueCommand(r,cmd('drop',4),'a');
 assert.deepEqual(r.commands.map(c=>[c.action,c.actor,c.areaId]),[['move','b',0],['move','a',1],['drop','a',0]]);
 assert.equal(enqueueCommand(r,cmd('move',3),'a'),false);
 assert.equal(enqueueCommand(r,cmd('collect',5),'a'),true);
 assert.deepEqual(r.commands.slice(-2).map(c=>c.action),['drop','collect']);
});
test('legacy sequence remains accepted; full queues coalesce movement but preserve critical operations',()=>{
 const r=room();enqueueCommand(r,cmd('move',undefined),'a');enqueueCommand(r,cmd('move',undefined),'a');
 assert.equal(r.commands.length,1);
 for(let i=0;i<255;i++)enqueueCommand(r,cmd('tool:buy:bag',undefined,i),'a');
 enqueueCommand(r,cmd('move',10),'a');assert.equal(r.commands.length,256);
 assert.throws(()=>enqueueCommand(r,cmd('collect',11,9),'a'),/繁忙/);
 enqueueCommand(r,cmd('sell',11),'a');assert.equal(r.commands.length,256);
 assert.equal(r.commands.filter(c=>c.action==='tool:buy:bag').length,255);
});
