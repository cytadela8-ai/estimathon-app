/** Fetch the built play entry point and same-origin linked resources as a new browser load would. */
function localUrls(values, base) {
  const urls = values.map((value) => new URL(value, base));
  return [...new Set(urls.filter((url) => url.origin === new URL(base).origin).map(String))];
}
async function resource(url, metrics) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = await response.arrayBuffer();
  metrics.resourceRequests++;
  metrics.resourceBytes += body.byteLength;
  if (!response.ok)
    throw new Error(`Loading participant resource ${url} failed: HTTP ${response.status}.`);
  return new TextDecoder().decode(body);
}

/** Load play HTML and its linked JS, CSS, icon and fonts; no DOM or JS execution is simulated. */
export async function loadPlayResources(origin, metrics) {
  const base = origin + '/play';
  const html = await resource(base, metrics);
  const links = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
  await Promise.all(
    localUrls(links, base).map(async (url) => {
      const body = await resource(url, metrics);
      if (!new URL(url).pathname.endsWith('.css')) return;
      const fonts = [...body.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map((m) => m[1]);
      await Promise.all(localUrls(fonts, url).map((font) => resource(font, metrics)));
    }),
  );
}
