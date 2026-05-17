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

    // /downloads/latest/{platform} → 302 to whatever the manifest currently
    // points at. Lets the homepage hardcode platform-keyed URLs once and
    // never touch them again across releases. Bare "windows"/"linux"
    // alias the x86_64 (majority) builds; "-arm64" suffix picks up the
    // aarch64 variants from the 0.4-and-later release matrix.
    const latestMatch = url.pathname.match(
      /^\/downloads\/latest\/(macos|windows|windows-arm64|linux|linux-arm64)\/?$/,
    );
    if (latestMatch) {
      return redirectToLatest(env.DOWNLOADS, latestMatch[1]);
    }

    if (url.pathname.startsWith('/downloads/')) {
      return serveFromR2(env.DOWNLOADS, url.pathname.slice('/downloads/'.length));
    }

    // Everything else falls through to the static assets directory.
    // Wrap to inject:
    //   - Link response headers (RFC 8288) advertising the sitemap +
    //     canonical to bots and discovery agents without HTML parsing.
    //   - data-country onto <html> from Cloudflare's cf.country so the
    //     page can pick the right currency (EUR vs USD) without
    //     guessing from navigator.language, which lies about location
    //     whenever a user has their browser set to en-US in Germany.
    const res = await env.ASSETS.fetch(request);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const headers = new Headers(res.headers);
      headers.append('link', '</sitemap.xml>; rel="sitemap"; type="application/xml"');
      headers.append('link', '<https://ambient.oezcan.me/>; rel="canonical"');
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
    return res;
  },
};

async function redirectToLatest(bucket, platform) {
  const manifest = await bucket.get('latest.json');
  if (!manifest) {
    return new Response('No release manifest', { status: 503 });
  }
  let data;
  try {
    data = JSON.parse(await manifest.text());
  } catch {
    return new Response('Corrupt release manifest', { status: 500 });
  }
  const target = data?.downloads?.[platform];
  if (!target) {
    return new Response('Platform not in manifest', { status: 404 });
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      // The alias itself shouldn't be cached for long — point users at the
      // current version, not yesterday's.
      'cache-control': 'public, max-age=60',
    },
  });
}

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
