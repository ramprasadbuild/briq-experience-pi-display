// What a screen receives as `data`: the project's payload from its local manifest, in which the
// sync agent has already rewritten every file URL to /content/files/<name>. A hidden `__keys` map
// leads back from those local paths to the original URLs, for the few places that read a URL as
// text (captions from file names, YouTube/Vimeo detection).

export function projectData(manifest) {
  const keys = new Map((manifest.files ?? []).map((f) => [f.path, f.key]));
  return { ...manifest.payload, __keys: keys };
}

/** The URL a local path came from (or the value itself when it was never rewritten). */
export const originalUrl = (data, localUrl) => data.__keys?.get(localUrl) ?? localUrl;

/** The project's cover: its hero image, else the first render. */
export const heroImage = (data) => data.hero_image ?? data.gallery?.[0];
