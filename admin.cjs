'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const digest=value=>crypto.createHash('sha256').update(value).digest();
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&crypto.timingSafeEqual(digest(a),digest(b));
function createAdmin({token=process.env.WEEDING_ADMIN_TOKEN||'',state,kick,close}){
 const sessions=new Map(),attempts=new Map(),enabled=Buffer.byteLength(token)>=32;
 const files=new Map([['/admin','index.html'],['/admin/','index.html'],['/admin/app.js','app.js'],['/admin/style.css','style.css']]);
 function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
 function session(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('weeding_admin='));const id=cookie?.slice(14),entry=sessions.get(id);if(!entry||entry.until<Date.now()){sessions.delete(id);return null;}return {...entry,id};}
 function secure(req){return !!req.socket.encrypted||(process.env.WEEDING_TRUST_PROXY==='1'&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.headers['x-forwarded-proto']==='https');}
 function originOK(req){if(!req.headers.origin)return true;try{const origin=new URL(req.headers.origin);return origin.host===req.headers.host&&['http:','https:'].includes(origin.protocol);}catch{return false;}}
 function cookie(req,id,age){return 'weeding_admin='+id+'; Path=/admin; HttpOnly; SameSite=Strict; Max-Age='+age+(secure(req)?'; Secure':'');}
 async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)throw Error('请求过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
 return async function handle(req,res){
  if(!req.url?.startsWith('/admin'))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const route=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&files.has(route)){
   try{const file=files.get(route);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'admin',file)));}catch{json(res,500,{ok:false,error:'管理页面文件缺失'});}return true;
  }
  if(!route.startsWith('/admin/api/')){json(res,404,{ok:false,error:'接口不存在'});return true;}
  if(!enabled){json(res,503,{ok:false,error:'管理后台未启用，请配置至少32字符的 WEEDING_ADMIN_TOKEN'});return true;}
  const ip=req.socket.remoteAddress||'',local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
  if(!secure(req)&&!local&&process.env.WEEDING_ADMIN_ALLOW_HTTP!=='1'){json(res,403,{ok:false,error:'请通过 HTTPS 或 SSH 隧道访问后台，避免明文传输管理密钥'});return true;}
  if(req.method==='POST'&&!originOK(req)){json(res,403,{ok:false,error:'请求来源无效'});return true;}
  try{
   if(req.method==='POST'&&route==='/admin/api/login'){
    const now=Date.now();for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
    if((attempts.get(ip)?.count||0)>=5){json(res,429,{ok:false,error:'尝试过多，请一分钟后重试'});return true;}
    const data=await body(req);
    if(!equal(data.token,token)){if(attempts.size>=1000)attempts.delete(attempts.keys().next().value);const previous=attempts.get(ip)||{count:0,until:now+60000};previous.count++;attempts.set(ip,previous);json(res,401,{ok:false,error:'管理密钥不正确'});return true;}
    attempts.delete(ip);for(const [id,s] of sessions)if(s.until<now)sessions.delete(id);if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
    const id=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');sessions.set(id,{csrf,until:now+8*3600000});res.setHeader('Set-Cookie',cookie(req,id,8*3600));json(res,200,{ok:true,csrf});return true;
   }
   const user=session(req);if(!user){json(res,401,{ok:false,error:'请先登录管理后台'});return true;}
   if(req.method==='GET'&&route==='/admin/api/session'){json(res,200,{ok:true,csrf:user.csrf});return true;}
   if(req.method==='GET'&&route==='/admin/api/rooms'){json(res,200,{ok:true,...state()});return true;}
   if(req.method!=='POST'||!equal(req.headers['x-admin-csrf'],user.csrf)){json(res,403,{ok:false,error:'操作校验失败，请刷新页面后重试'});return true;}
   if(route==='/admin/api/logout'){sessions.delete(user.id);res.setHeader('Set-Cookie',cookie(req,'',0));json(res,200,{ok:true});return true;}
   const match=/^\/admin\/api\/rooms\/([0-9]{6})\/(kick|close)$/.exec(route);if(!match){json(res,404,{ok:false,error:'接口不存在'});return true;}
   const data=await body(req);const result=match[2]==='kick'?kick(match[1],data.actor,data.createdAt):close(match[1],data.createdAt);json(res,result?200:404,result?{ok:true}:{ok:false,error:'房间或客人已不存在，操作未执行'});
  }catch{json(res,400,{ok:false,error:'请求无效或操作未完成'});}
  return true;
 };
}
module.exports={createAdmin};
