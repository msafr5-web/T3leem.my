/**
 * REAL ffmpeg: generates a short test clip, transcodes it to AES-128 HLS, then proves the
 * segments on disk are encrypted (unreadable as MPEG-TS) and that the content key decrypts them.
 */
import { createDecipheriv, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { FfmpegTranscoder } from '../../src/modules/lms/media/transcoder';

const describeFfmpeg = ffmpegPath && existsSync(ffmpegPath) ? describe : describe.skip;

describeFfmpeg('FfmpegTranscoder (real ffmpeg)', () => {
  jest.setTimeout(120_000);
  const dir = mkdtempSync(path.join(tmpdir(), 't3leem-ffmpeg-'));
  const source = path.join(dir, 'source.mp4');
  const out = path.join(dir, 'hls');
  const key = randomBytes(16);

  beforeAll(() => {
    // 8 s synthetic clip: test pattern + tone.
    execFileSync(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source,
    ]);
  });

  it('produces an encrypted VOD playlist with segments and removes the clear key', async () => {
    const { durationSeconds } = await new FfmpegTranscoder(ffmpegPath as string).toEncryptedHls({ sourcePath: source, outDir: out, key });

    expect(durationSeconds).toBeGreaterThanOrEqual(7);
    const playlist = readFileSync(path.join(out, 'playlist.m3u8'), 'utf8');
    expect(playlist).toContain('#EXT-X-KEY:METHOD=AES-128,URI="key"');
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');

    const files = readdirSync(out);
    expect(files.filter((f) => /^seg_\d{4}\.ts$/.test(f)).length).toBeGreaterThanOrEqual(2);
    // The clear key must not be left next to the segments.
    expect(files).not.toContain('enc.key');
    expect(files).not.toContain('enc.keyinfo');
  });

  it('segments are not readable MPEG-TS without the key, and decrypt correctly with it', () => {
    const segment = readFileSync(path.join(out, 'seg_0000.ts'));
    // A clear TS stream starts with sync byte 0x47 every 188 bytes.
    expect(segment[0] === 0x47 && segment[188] === 0x47).toBe(false);

    // HLS default IV = media sequence number (0 for the first segment) as a 128-bit big-endian int.
    const iv = Buffer.alloc(16);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    const clear = Buffer.concat([decipher.update(segment), decipher.final()]);
    expect(clear[0]).toBe(0x47);
    expect(clear[188]).toBe(0x47);
  });

  it('a wrong key cannot decrypt the segment', () => {
    const segment = readFileSync(path.join(out, 'seg_0000.ts'));
    const decipher = createDecipheriv('aes-128-cbc', randomBytes(16), Buffer.alloc(16));
    let clear: Buffer | null = null;
    try {
      clear = Buffer.concat([decipher.update(segment), decipher.final()]);
    } catch {
      clear = null; // bad padding: expected for a wrong key
    }
    expect(clear === null || !(clear[0] === 0x47 && clear[188] === 0x47)).toBe(true);
  });

  it('fails cleanly on a non-video source', async () => {
    const bogus = path.join(dir, 'bogus.mp4');
    require('node:fs').writeFileSync(bogus, 'not a video');
    await expect(new FfmpegTranscoder(ffmpegPath as string).toEncryptedHls({ sourcePath: bogus, outDir: path.join(dir, 'bad'), key })).rejects.toThrow(/ffmpeg exited/);
    expect(existsSync(path.join(dir, 'bad', 'enc.key'))).toBe(false);
  });

  it('rejects keys that are not 16 bytes', async () => {
    await expect(new FfmpegTranscoder(ffmpegPath as string).toEncryptedHls({ sourcePath: source, outDir: out, key: randomBytes(8) })).rejects.toThrow('16 bytes');
  });
});
