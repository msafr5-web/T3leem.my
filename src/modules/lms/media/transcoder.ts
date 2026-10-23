import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface TranscodeRequest {
  sourcePath: string;
  outDir: string;
  /** 16-byte AES-128 content key. Written to a temp file for ffmpeg and deleted afterwards. */
  key: Buffer;
}

export interface Transcoder {
  toEncryptedHls(req: TranscodeRequest): Promise<{ durationSeconds: number }>;
}

/** Placeholder URI written into the playlist; replaced per-request with a signed key URL. */
export const KEY_URI_PLACEHOLDER = 'key';

/**
 * FFmpeg -> HLS with AES-128 segment encryption (SWET §5). 6-second segments, H.264/AAC so
 * every browser (via hls.js) and Safari (natively) can play it.
 */
export class FfmpegTranscoder implements Transcoder {
  constructor(
    private readonly ffmpegPath: string,
    private readonly timeoutMs = 60 * 60 * 1000,
  ) {}

  async toEncryptedHls({ sourcePath, outDir, key }: TranscodeRequest): Promise<{ durationSeconds: number }> {
    if (key.length !== 16) throw new Error('AES-128 key must be 16 bytes');
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const keyFile = path.join(outDir, 'enc.key');
    const keyInfo = path.join(outDir, 'enc.keyinfo');
    await writeFile(keyFile, key);
    // keyinfo: line 1 = URI written into the playlist, line 2 = key file path for ffmpeg.
    await writeFile(keyInfo, `${KEY_URI_PLACEHOLDER}\n${keyFile}\n`);

    try {
      await this.run([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', sourcePath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        // HLS can only cut at keyframes; x264's default GOP (~10 s) would silently produce
        // 10 s+ segments. Force one every 6 s so -hls_time is actually honored.
        '-force_key_frames', 'expr:gte(t,n_forced*6)',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_key_info_file', keyInfo,
        '-hls_segment_filename', path.join(outDir, 'seg_%04d.ts'),
        path.join(outDir, 'playlist.m3u8'),
      ]);
    } finally {
      // The clear key must never remain on disk next to the encrypted segments.
      await rm(keyFile, { force: true });
      await rm(keyInfo, { force: true });
    }

    const playlist = await readFile(path.join(outDir, 'playlist.m3u8'), 'utf8');
    return { durationSeconds: Math.round(parsePlaylistDuration(playlist)) };
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      const timer = setTimeout(() => proc.kill('SIGKILL'), this.timeoutMs);
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop() ?? ''}`));
      });
    });
  }
}

export function parsePlaylistDuration(playlist: string): number {
  return playlist
    .split('\n')
    .filter((l) => l.startsWith('#EXTINF:'))
    .reduce((sum, l) => sum + Number.parseFloat(l.slice('#EXTINF:'.length)), 0);
}

/**
 * Rewrites a stored playlist for one viewer: the key URI and every segment get the viewer's
 * signed token, so the playlist is useless once the token expires or is shared elsewhere.
 */
export function signPlaylist(playlist: string, token: string): string {
  const q = `token=${encodeURIComponent(token)}`;
  return playlist
    .split('\n')
    .map((line) => {
      if (line.startsWith('#EXT-X-KEY:')) return line.replace(`URI="${KEY_URI_PLACEHOLDER}"`, `URI="key?${q}"`);
      if (/^seg_\d{4,5}\.ts$/.test(line.trim())) return `segments/${line.trim()}?${q}`;
      return line;
    })
    .join('\n');
}
