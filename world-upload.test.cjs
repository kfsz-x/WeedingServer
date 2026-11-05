const test=require('node:test'), assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const {decodeWorldInput}=require('./world-upload.cjs');
test('large valid compressed upload avoids recursive base64 validation overflow',()=>{
 const world=JSON.stringify({plants:[],message:require('node:crypto').randomBytes(8*1024*1024).toString('base64')});
 const compressedWorld=payload(world);assert.ok(compressedWorld.data.length>10000000);
 assert.equal(decodeWorldInput({compressedWorld}),world);
});
function payload(world){const raw=Buffer.from(world);return {encoding:'gzip-base64',rawBytes:raw.length,hash:createHash('sha256').update(raw).digest('hex'),data:gzipSync(raw).toString('base64')};}
test('accepts legacy world or compressed UTF8 world with validated hash',()=>{
 const world='草地🌿'.repeat(20000);assert.equal(decodeWorldInput({world}),world);
 assert.equal(decodeWorldInput({compressedWorld:payload(world)}),world);
 assert.equal(decodeWorldInput({}),undefined);
});
test('rejects ambiguous, corrupt, invalid UTF8 and excessive decompression input',()=>{
 const good=payload('hello');
 assert.throws(()=>decodeWorldInput({world:'hello',compressedWorld:good}));
 for(const change of [{rawBytes:4},{rawBytes:6},{hash:'0'.repeat(64)},{encoding:'raw'},{data:'!!!!'},{rawBytes:16*1024*1024+1}])assert.throws(()=>decodeWorldInput({compressedWorld:{...good,...change}}));
 const invalid=Buffer.from([0xff]);assert.throws(()=>decodeWorldInput({compressedWorld:{...good,rawBytes:1,hash:createHash('sha256').update(invalid).digest('hex'),data:gzipSync(invalid).toString('base64')}}));
 const bomb=payload('x'.repeat(100000));bomb.rawBytes=1;assert.throws(()=>decodeWorldInput({compressedWorld:bomb}));
 assert.throws(()=>decodeWorldInput({world:'x'.repeat(16*1024*1024+1)}));
});
