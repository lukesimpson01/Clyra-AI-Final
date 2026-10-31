// Runtime piece of Clyra's shared schema used by its transplanted timeline.
export function outputSize(aspect: string, resolution: number) {
  const [w, h] = aspect.split(':').map(Number);
  const even = (value: number) => Math.round(value / 2) * 2;
  if (w < h) return { width: resolution, height: even((resolution * h) / w) };
  if (w > h) return { width: even((resolution * w) / h), height: resolution };
  return { width: resolution, height: resolution };
}
