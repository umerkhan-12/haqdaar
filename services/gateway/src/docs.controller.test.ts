import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENTED, docsPath, rewriteDocsHtml, rewriteDocsInit } from './docs.controller';

test('asset links become relative to /docs/<service>, so they work under any prefix', () => {
  const html =
    '<link href="./docs/swagger-ui.css"><script src="./docs/swagger-ui-init.js"></script>';
  assert.equal(
    rewriteDocsHtml(html, 'cases'),
    '<link href="./cases/swagger-ui.css"><script src="./cases/swagger-ui-init.js"></script>',
  );
});

test('the spec gets a gateway server so "Try it out" does not call the docs folder', () => {
  const js = 'let options = { "swaggerDoc": { "openapi": "3.0.0", "servers": [], "paths": {} } }';
  const out = rewriteDocsInit(js);
  assert.ok(
    out.includes(
      '"servers": [{ "url": window.location.origin + window.location.pathname.split("/docs/")[0]',
    ),
  );
  assert.ok(out.includes('"openapi": "3.0.0"') && !out.includes('"servers": []'));
});

test('every backend is documented, the gateway itself is not proxied', () => {
  assert.ok(DOCUMENTED.includes('identity') && DOCUMENTED.includes('rails-mock'));
  assert.ok(!(DOCUMENTED as string[]).includes('gateway'));
  assert.equal(docsPath('cases'), '/docs/cases');
});
