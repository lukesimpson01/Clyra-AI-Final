
/*
 * Clyra's editor mark: a play triangle inside a rounded square, in the surrounding text's color.
 * (OpenFilm's own mark is a trademark of that project and is not used in this build.)
 */
export function BrandLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="block shrink-0" role="img" aria-label="Clyra Editor">
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M10 8.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1l-6-3.8a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}
