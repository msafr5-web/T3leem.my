/** Academy logo if uploaded (versioned URL for cache-busting), otherwise the first letter of the name. */
export function LogoMark({ slug, name, version, size = 28 }: { slug: string; name: string; version: string | null; size?: number }) {
  if (version) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny proxied logo; next/image adds nothing here
      <img
        src={`/${slug}/logo?v=${version}`}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8, background: '#fff' }}
      />
    );
  }
  return (
    <span className="brand-dot" aria-hidden="true" style={{ width: size, height: size }}>
      {name.charAt(0)}
    </span>
  );
}
