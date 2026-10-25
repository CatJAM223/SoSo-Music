import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

// React Refresh adds an inline preamble in development. Authorize its exact
// contents instead of allowing arbitrary inline JavaScript in the app policy.
export function devCspHashes(): Plugin {
  return {
    name: 'soso-dev-csp-hashes',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
          .filter(([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) && body.trim())
          .map(
            ([, , body]) => "'sha256-" + createHash('sha256').update(body).digest('base64') + "'",
          );
        return html.replace(
          /(script-src\s+[^;]+);/,
          (_match, directive) => directive + (hashes.length ? ' ' + hashes.join(' ') : '') + ';',
        );
      },
    },
  };
}
