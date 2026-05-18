// Extract the release notes block for a specific version from
// CHANGELOG.md. Looks for a `## [<version>] — <date>` (or any extra
// suffix) heading and captures everything up to the next `## [` or
// EOF. If the version isn't found, writes a one-line fallback so
// `gh release create --notes-file` always has something.
//
// CLI:
//   node extract-changelog.mjs \
//     --version 0.7.0 \
//     --output /tmp/notes.md \
//     [--changelog ./CHANGELOG.md]

import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    changelog: { type: 'string', default: './CHANGELOG.md' },
    output: { type: 'string' },
  },
});

for (const k of ['version', 'output']) {
  if (!values[k]) {
    console.error(`Missing required --${k}`);
    process.exit(1);
  }
}

const text = fs.readFileSync(values.changelog, 'utf8');
const v = values.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`## \\[${v}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
const m = text.match(re);

const notes = m ? m[1].trim() : `Release v${values.version}`;
fs.writeFileSync(values.output, notes + '\n');
console.log(`Wrote ${values.output} (${notes.length} chars)`);
