const test = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { randomBytes, createHash } = require('node:crypto');
const { SnapshotArchive } = require('./snapshot-transfer.cjs');

test('immutable snapshot roundtrip has bounded compressed chunks and UTF8 integrity', () => {
  const archive = new SnapshotArchive();
  const world = JSON.stringify({ text: '草地🌿' + randomBytes(180000).toString('base64') });
  const descriptor = archive.describe('a', world, 7);
  assert.equal(descriptor.encoding, 'gzip-base64');
  assert.ok(descriptor.totalChunks > 1);
  const chunks = Array.from({ length: descriptor.totalChunks }, (_, index) => {
    const response = archive.chunk('a', descriptor.id, index);
    assert.equal(response.index, index);
    const bytes = Buffer.from(response.data, 'base64');
    assert.ok(bytes.length <= 65536);
    return bytes;
  });
  const raw = gunzipSync(Buffer.concat(chunks));
  assert.equal(raw.toString('utf8'), world);
  assert.equal(raw.length, descriptor.rawBytes);
  assert.equal(Buffer.concat(chunks).length, descriptor.encodedBytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), descriptor.hash);
  assert.deepEqual(archive.describe('a', world, 7), descriptor);
  archive.describe('a', '{"new":true}', 8);
  assert.equal(archive.chunk('a', descriptor.id, 0).data, chunks[0].toString('base64'));
  assert.throws(() => archive.chunk('b', descriptor.id, 0));
  for (const index of [-1, 0.5, descriptor.totalChunks]) assert.throws(() => archive.chunk('a', descriptor.id, index));
});

test('retention expires and caps versions, rooms, and bytes', () => {
  let now = 0;
  const archive = new SnapshotArchive({ now: () => now, maxVersions: 2, maxRooms: 2, maxBytes: 100000 });
  const first = archive.describe('a', 'one', 1);
  archive.describe('a', 'two', 2);
  assert.throws(() => archive.describe('a', 'three', 3), /capacity/);
  assert.ok(archive.chunk('a', first.id, 0));
  const second = archive.describe('b', 'two', 2);
  assert.throws(() => archive.describe('c', 'three', 3), /capacity/);
  assert.throws(() => archive.describe('d', 'four', 4), /capacity/);
  now = 30001;
  assert.throws(() => archive.chunk('b', second.id, 0), /expired/);
  assert.ok(archive.describe('d', 'four', 4));
  archive.drop('d');
  assert.equal(archive.rooms.size, 0);
});

test('input and capacity limits reject without evicting active transfers', () => {
  const archive = new SnapshotArchive({ maxRawBytes: 100, maxBytes: 30 });
  assert.throws(() => archive.describe('a', 'x'.repeat(101), 1), /large/);
  const first = archive.describe('a', 'one', 1);
  assert.throws(() => archive.describe('b', randomBytes(50).toString('hex'), 1), /capacity/);
  assert.ok(archive.chunk('a', first.id, 0));
  assert.throws(() => archive.describe('a', null, 1));
});


