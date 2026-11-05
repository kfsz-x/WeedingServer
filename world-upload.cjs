'use strict';
const {gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {TextDecoder}=require('node:util');
const MAX_BYTES=16*1024*1024;
function validBase64(text){
  if(text.length%4!==0||/[^A-Za-z0-9+/=]/.test(text))return false;
  const padding=text.indexOf('=');if(padding<0)return true;
  const count=text.length-padding;
  if(count<1||count>2||text.slice(padding)!=='='.repeat(count))return false;
  const digit='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(text[padding-1]);
  return digit>=0&&(digit&(count===2?15:3))===0;
}
function decodeWorldInput(data) {
  if(data.compressedWorld==null){
    if(data.world!=null && (typeof data.world!=='string' || Buffer.byteLength(data.world)>MAX_BYTES))throw new Error('World too large or invalid');
    return data.world;
  }
  // JsonUtility writes the temporarily blanked raw field as an empty string.
  if(data.world!=null && data.world!=='')throw new Error('Ambiguous world input');
  const p=data.compressedWorld;
  if(typeof p!=='object'||p.encoding!=='gzip-base64'||!Number.isInteger(p.rawBytes)||p.rawBytes<0||p.rawBytes>MAX_BYTES||
    typeof p.hash!=='string'||!/^[0-9a-f]{64}$/i.test(p.hash)||typeof p.data!=='string'||p.data.length>Math.ceil(MAX_BYTES/3)*4||
    !validBase64(p.data))throw new Error('Invalid compressed world');
  const compressed=Buffer.from(p.data,'base64');
  if(compressed.length>MAX_BYTES)throw new Error('Compressed world too large');
  const raw=gunzipSync(compressed,{maxOutputLength:Math.max(1,p.rawBytes)});
  if(raw.length!==p.rawBytes||createHash('sha256').update(raw).digest('hex')!==p.hash.toLowerCase())throw new Error('World integrity mismatch');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
}
module.exports={decodeWorldInput,MAX_BYTES};
