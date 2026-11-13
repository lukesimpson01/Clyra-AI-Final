import * as React from "react";

/** Frame-only stand-in for next/link so upstream demos render in the preview sandbox. */
const Link = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: unknown; prefetch?: boolean; scroll?: boolean; replace?: boolean }>(
  function Link({ href, prefetch: _p, scroll: _s, replace: _r, onClick, ...rest }, ref) {
    return <a ref={ref} href={typeof href === "string" ? href : "#"} onClick={(event) => { event.preventDefault(); onClick?.(event); }} {...rest} />;
  },
);
export default Link;
