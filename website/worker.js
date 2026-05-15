// ambient-site Worker.
//
// Two responsibilities:
// 1. Serve the static marketing site (delegated to the env.ASSETS
//    binding configured in wrangler.jsonc's "assets" field).
// 2. Serve installer downloads + the update manifest from the R2
//    bucket bound at env.DOWNLOADS, exposed under /downloads/*.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/downloads/')) {
      return serveFromR2(env.DOWNLOADS, url.pathname.slice('/downloads/'.length));
    }

    // Everything else falls through to the static assets directory.
    return env.ASSETS.fetch(request);
  },
};

async function serveFromR2(bucket, key) {
  if (!key) {
    return new Response('Missing file path', { status: 400 });
  }

  const obj = await bucket.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  if (obj.httpMetadata?.contentType) {
    headers.set('content-type', obj.httpMetadata.contentType);
  } else {
    headers.set('content-type', contentTypeFor(key));
  }
  headers.set('content-length', String(obj.size));

  // Force download for installer binaries; render JSON inline so the
  // update manifest can be fetched as JSON by the desktop app and the
  // browser without prompting a download dialog.
  if (!key.endsWith('.json')) {
    const filename = key.split('/').pop();
    headers.set('content-disposition', `attachment; filename="${filename}"`);
  }

  // 5-minute browser cache; CF edge cache is opportunistic. version.json
  // gets a shorter cache so the update checker sees new releases quickly.
  headers.set(
    'cache-control',
    key.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=300',
  );

  return new Response(obj.body, { headers });
}

function contentTypeFor(name) {
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (name.endsWith('.msi')) return 'application/x-msi';
  if (name.endsWith('.AppImage')) return 'application/x-executable';
  if (name.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (name.endsWith('.flatpak')) return 'application/vnd.flatpak';
  if (name.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
