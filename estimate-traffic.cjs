// Payload model, not a Unity JsonUtility capture or a network benchmark.
// Counts UTF-8 bytes including nested JSON string escaping. No HTTP/TLS overhead.
const bytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
const v={x:12.345678,y:1.234567,z:-23.456789},q={x:0,y:0.1234567,z:0,w:0.9876543};
const plant=id=>({bagOwner:'12345678',id,kind:1,state:3,bagOrder:-1,position:v,scale:{x:1,y:1,z:1},curl:v,rotation:q});
const request={protocol:6,room:'123456',token:'a'.repeat(48),password:'',salt:'',hash:'',world:'',action:'',id:0,revision:10000,ack:10000,commandId:'',device:'12345678',patch:'',target:'',playerId:'b'.repeat(32),activeSeconds:3600.123456,clientSequence:10000,areaId:2,plant:null,fps:60.12345,latency:10.12345,failures:0,requests:36000,pose:{position:v,yaw:123.45678}};
const command={...request,action:'move',commandId:'c'.repeat(32),plant:plant(10009),pose:null};
const stats=Array.from({length:4},(_,i)=>({playerId:String(i).repeat(32),pulls:2500,seconds:3600.123456}));
const areas=counts=>({currentArea:2,uniquePulls:counts.reduce((a,b)=>a+b,0),areas:counts.map((n,i)=>({areaId:i,plantCount:[1010,5010,10010][i],plantData:null,initialized:true,metadataOnly:true,sparsePlants:true,plants:[],pulledIds:Array.from({length:n},(_,j)=>j)}))});
const peers=Array.from({length:3},(_,i)=>({id:String(i).repeat(8),playerId:String(i).repeat(32),activeSeconds:3600.123456,position:v,yaw:123.45678}));
const baseReply={ok:true,protocol:6,revision:10000,members:[{id:'host',host:true},...peers.map(p=>({id:p.id,host:false}))],peers};
const sizes={heartbeatRequest:bytes(request),moveCommandRequest:bytes(command),singlePlant:bytes(plant(10009)),pollWithoutDelta:bytes(baseReply)};
const scenarios=[];
for(const [name,counts,changed,packed] of [['early',[0,0,0],4,0],['late_ids',[1000,5000,10000],4,0],['late_bundle_contents',[1000,5000,10000],4,10000],['all_current_plants_changed',[1000,5000,10000],10010,0]]){
 const delta={gardenLayoutVersion:1,contentVersion:3,plantCount:10010,sparsePlants:true,merchantSaleSequence:64,merchantSales:Array.from({length:64},(_,id)=>({id,areaId:2,amount:5})),progress:{exitUnlocked:false,settled:false,players:stats},bundles:{nextId:2,items:packed?[{id:1,areaId:2,owner:'',position:v,velocity:v,rotation:q,flying:false,contents:Array.from({length:packed},(_,plantId)=>({areaId:2,plantId,kind:0,value:1}))}]:[],carriedGrass:[],settledPlants:[]},tools:{gloveLevel:2,nextItemId:1,bagLevel:2,sprintUnlocked:true,items:[]},areas:areas(counts),coins:10000,expanded:true,goldFinger:true,plants:Array.from({length:changed},(_,id)=>plant(id)),removed:[]};
 const host=bytes({...request,patch:JSON.stringify(delta)}),guest=bytes({...baseReply,delta:JSON.stringify(delta)});
 // 10 heartbeat polls/s/person, 2 world updates/s; 3 guests each holding/moving grass at 10 commands/s.
 const guestUp=10*sizes.heartbeatRequest+10*sizes.moveCommandRequest;
 const hostUp=8*sizes.heartbeatRequest+2*host;
 const guestDown=8*sizes.pollWithoutDelta+2*guest;
 // Host command replies: model 30 forwarded commands/s; commands have actor/sequence rather than request envelope.
 const forwarded=bytes({action:'move',id:10009,actor:'12345678',areaId:2,plant:plant(10009),clientSequence:10000,sequence:10000})+1;
 const serverOut=3*guestDown+10*bytes({...baseReply,commands:[]})+30*forwarded+30*bytes({ok:true,protocol:6});
 scenarios.push({name,changedPlants:changed,packedEntries:packed,hostPatchRequestBytes:host,guestDeltaResponseBytes:guest,hostUploadBytesPerSecond:hostUp,guestUploadBytesPerSecond:guestUp,guestDownloadBytesPerSecond:guestDown,serverIngressBytesPerSecond:hostUp+3*guestUp,serverEgressBytesPerSecond:serverOut,serverEgressMbps:serverOut*8/1e6,serverEgressGBPerHour:serverOut*3600/1e9});
}
console.log(JSON.stringify({assumptions:'Synthetic representative float values, empty tools, four historical player stats, 64 sale events, no retries, no joins/full snapshots, no HTTP/TLS overhead. Not a maximum or measured live traffic.',sizes,scenarios},null,2));
