'use strict';
class CapacityGuard {
 constructor(options={}) {
  this.limits={maxRooms:5,maxPlayers:20,maxRssMb:512,maxCpu:85,maxLagMs:100,...options};
  for(const [name,value] of Object.entries(this.limits))if(!Number.isFinite(value)||value<=0)throw Error('Invalid capacity configuration: '+name);
  this.bad=0;this.good=0;this.overloaded=false;this.metrics={rssMb:0,cpu:0,lagMs:0};
 }
 sample(metrics){
  this.metrics=metrics;const l=this.limits;
  if(metrics.rssMb>=l.maxRssMb||metrics.cpu>=l.maxCpu||metrics.lagMs>=l.maxLagMs){this.good=0;if(++this.bad>=3)this.overloaded=true;}
  else{this.bad=0;if(++this.good>=5)this.overloaded=false;}
 }
 reason(action,rooms,players){
  if(this.overloaded)return 'RESOURCE_LIMIT';
  if(players>=this.limits.maxPlayers)return 'PLAYER_LIMIT';
  if(action==='create'&&rooms>=this.limits.maxRooms)return 'ROOM_LIMIT';
  return null;
 }
}
module.exports={CapacityGuard};
