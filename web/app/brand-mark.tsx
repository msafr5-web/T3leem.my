/** The T3leem.my emblem (school, open book and pen). Academies keep their own mark: see logo-mark.tsx. */
export function PlatformEmblem({ size = 54 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed 96px asset; next/image adds nothing here
    <img src="/brand/emblem-96.png" alt="" width={size} height={size} className="brand-emblem" style={{ width: size, height: size }} />
  );
}

/** The full lock-up (emblem + wordmark) for hero areas and the owner console. */
export function PlatformLogo({ width = 320 }: { width?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset
    <img src="/brand/logo.jpg" alt="T3leem.my" width={width} height={Math.round((width * 640) / 960)} className="brand-logo" style={{ width, height: 'auto' }} />
  );
}
