import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Object storage port. The local adapter keeps files under STORAGE_DIR; an S3 adapter
 * (SWET: "AWS S3 Storage — Assets & DRM") implements the same interface without touching callers.
 */
export interface FileStorage {
  writeStream(key: string, source: Readable): Promise<number>;
  writeFile(key: string, data: Buffer | string): Promise<void>;
  readFile(key: string): Promise<Buffer>;
  createReadStream(key: string): Readable;
  size(key: string): Promise<number | null>;
  removePrefix(prefix: string): Promise<void>;
  /** Atomic rename within the store (used to publish a completed upload in one step). */
  move(fromKey: string, toKey: string): Promise<void>;
  /** Absolute filesystem path for tools that need one (ffmpeg). Local adapter only. */
  localPath(key: string): string;
}

const KEY_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Keys are built from ids we control, but this is the last line of defence against path
   * traversal: only plain segments, no "..", and the resolved path must stay under root.
   */
  localPath(key: string): string {
    if (!KEY_RE.test(key) || key.split('/').includes('..')) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Storage key escapes root: ${key}`);
    return full;
  }

  async writeStream(key: string, source: Readable): Promise<number> {
    const target = this.localPath(key);
    // Synchronous on purpose: the pipeline (and its error handling) must be attached before
    // the event loop turns, or an already-flowing source can emit data/errors with no listener.
    mkdirSync(path.dirname(target), { recursive: true });
    const out = createWriteStream(target);
    await pipeline(source, out);
    return out.bytesWritten;
  }

  async writeFile(key: string, data: Buffer | string): Promise<void> {
    const target = this.localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  readFile(key: string): Promise<Buffer> {
    return readFile(this.localPath(key));
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.localPath(key));
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.localPath(key))).size;
    } catch {
      return null;
    }
  }

  async removePrefix(prefix: string): Promise<void> {
    await rm(this.localPath(prefix), { recursive: true, force: true });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const to = this.localPath(toKey);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(this.localPath(fromKey), to);
  }
}
