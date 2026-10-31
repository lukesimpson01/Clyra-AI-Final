/* Pictures added to a story (a post image, a profile photo, a message photo, an option picture) are kept as small JPEG
   data URLs: they survive a reload, travel from the home tools into the editor's sidebar, and need no upload. */
export async function fileToDataUrl(file, max = 960) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale));
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** A data URL (or any URL) as a Blob, for sending to a render. */
export async function urlToBlob(url) { return (await fetch(url)).blob(); }
