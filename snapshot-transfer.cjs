'use strict';
const { gzipSync } = require('node:zlib');
const { createHash, randomBytes } = require('node:crypto');
const CHUNK_BYTES = 64 * 1024;
class SnapshotArchive {
  constructor({ now = Date.now, ttlMs = 30000, maxVersions = 4, maxRooms = 64,
    maxBytes = 64 * 1024 * 1024, maxRawBytes = 16 * 1024 * 1024 } = {}) {
    Object.assign(this, { now, ttlMs, maxVersions, maxRooms, maxBytes, maxRawBytes });
    this.rooms = new Map();
    this.bytes = 0;
  }
  prune() {
    const now = this.now();
    for (const [room, versions] of this.rooms) {
      for (const [id, entry] of versions) if (entry.expires <= now) {
        versions.delete(id); this.bytes -= entry.compressed.length;
      }
      if (!versions.size) this.rooms.delete(room);
    }
  }
  describe(room, world, revision) {
    this.prune();
    if (typeof world !== 'string' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid snapshot input');
    const rawBytes = Buffer.byteLength(world);
    if (rawBytes > this.maxRawBytes) throw new Error('Snapshot too large');
    let versions = this.rooms.get(room);
    // Equal revision alone is not sufficient: callers may replace a world at the same revision.
    const hash = createHash('sha256').update(world).digest('hex');
    if (versions) for (const entry of versions.values()) if (entry.descriptor.revision === revision && entry.descriptor.hash === hash) {
      entry.expires = this.now() + this.ttlMs;
      return entry.descriptor;
    }
    if (!versions && this.rooms.size >= this.maxRooms) throw new Error('Snapshot capacity reached');
    if (versions && versions.size >= this.maxVersions) throw new Error('Snapshot capacity reached');
    const compressed = gzipSync(world);
    if (this.bytes + compressed.length > this.maxBytes) throw new Error('Snapshot capacity reached');
    const descriptor = Object.freeze({ id: randomBytes(16).toString('hex'), revision, encoding: 'gzip-base64',
      totalChunks: Math.ceil(compressed.length / CHUNK_BYTES), rawBytes, encodedBytes: compressed.length, hash });
    if (!versions) { versions = new Map(); this.rooms.set(room, versions); }
    versions.set(descriptor.id, { descriptor, compressed, expires: this.now() + this.ttlMs });
    this.bytes += compressed.length;
    return descriptor;
  }
  chunk(room, id, index) {
    this.prune();
    const entry = this.rooms.get(room)?.get(id);
    if (!entry) throw new Error('Snapshot expired; request a new full world');
    if (!Number.isInteger(index) || index < 0 || index >= entry.descriptor.totalChunks) throw new Error('Invalid snapshot chunk');
    return { ok: true, snapshotId: id, index,
      data: entry.compressed.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString('base64') };
  }
  drop(room) {
    const versions = this.rooms.get(room);
    if (versions) for (const entry of versions.values()) this.bytes -= entry.compressed.length;
    this.rooms.delete(room);
  }
}
module.exports = { SnapshotArchive, CHUNK_BYTES };

