'use strict';
class RoomTraffic {
 constructor(){this.receivedBytes=0;this.sentBytes=0;this.samples=new Map();}
 add(received,sent,now=Date.now()){
  if(!Number.isFinite(received)||!Number.isFinite(sent)||received<0||sent<0)return;
  this.receivedBytes+=received;this.sentBytes+=sent;
  const second=Math.floor(now/1000),sample=this.samples.get(second)||{received:0,sent:0};sample.received+=received;sample.sent+=sent;this.samples.set(second,sample);this.prune(second);
 }
 prune(second){for(const key of this.samples.keys())if(key<second-4)this.samples.delete(key);}
 snapshot(now=Date.now()){
  this.prune(Math.floor(now/1000));let received=0,sent=0;for(const sample of this.samples.values()){received+=sample.received;sent+=sample.sent;}
  return {receivedBytes:this.receivedBytes,sentBytes:this.sentBytes,receivedBytesPerSecond:received/5,sentBytesPerSecond:sent/5};
 }
}
module.exports={RoomTraffic};
