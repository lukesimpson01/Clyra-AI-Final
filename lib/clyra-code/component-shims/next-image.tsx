import * as React from "react";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string }; fill?: boolean; priority?: boolean; quality?: number; unoptimized?: boolean; placeholder?: string; blurDataURL?: string };
/** Frame-only stand-in for next/image. */
export default function Image({ src, fill, priority: _p, quality: _q, unoptimized: _u, placeholder: _ph, blurDataURL: _b, style, ...rest }: Props) {
  const url = typeof src === "string" ? src : src.src;
  return <img src={url} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style } : style} {...rest} />;
}
