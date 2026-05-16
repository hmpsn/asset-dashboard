import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRiskyModuleDashboardReport,
  countRiskMarkers,
  countRouteWriteHandlers,
  extractImportSpecifiers,
  parseCliArgs,
} from '../../scripts/platform-risky-module-dashboard.js';

const tempDirs: string[] = [];

function writeFile(baseDir: string, relativePath: string, content: string): void {
  const absolutePath = path.join(baseDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
}

function makeFixtureProject(): string {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'risky-mod-dashboard-'));
  tempDirs.push(fixtureRoot);

  writeFile(
    fixtureRoot,
    'server/services/helper.ts',
    [
      'export function helper(): string {',
      '  // TODO: tighten helper contracts',
      '  // route-contract-ok',
      "  return 'ok';",
      '}',
      '',
    ].join('\n'),
  );

  writeFile(
    fixtureRoot,
    'server/routes/foo.ts',
    [
      "import { helper } from '../services/helper';",
      'export function mountFoo(app: { post: (...args: unknown[]) => void }): void {',
      "  app.post('/api/foo', () => helper());",
      '}',
      '',
    ].join('\n'),
  );

  writeFile(
    fixtureRoot,
    'server/routes/bar.ts',
    [
      "import { helper } from '../services/helper';",
      'export function mountBar(router: { post: (...args: unknown[]) => void }): void {',
      "  router.post('/api/bar', () => helper());",
      '}',
      '',
    ].join('\n'),
  );

  writeFile(
    fixtureRoot,
    'tests/integration/bar-routes.test.ts',
    [
      "describe('bar routes', () => {",
      "  it('POST /api/bar works', () => {",
      '    expect(1).toBe(1);',
      '  });',
      '});',
      '',
    ].join('\n'),
  );

  writeFile(
    fixtureRoot,
    'tests/unit/helper.test.ts',
    [
      "import { helper } from '../../server/services/helper';",
      "describe('helper', () => {",
      "  it('returns ok', () => {",
      "    expect(helper()).toBe('ok');",
      '  });',
      '});',
      '',
    ].join('\n'),
  );

  return fixtureRoot;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('platform risky module dashboard', () => {
  it('counts route write handlers', () => {
    expect(countRouteWriteHandlers("router.post('/x', fn);\napp.delete('/y', fn);\nrouter.get('/z', fn);\n")).toBe(2);
  });

  it('counts TODO/FIXME/HACK + hatch comments', () => {
    const markers = countRiskMarkers('// TODO one\n// fixme two\n// route-contract-ok\n// HACK three\n');
    expect(markers.todoCount).toBe(3);
    expect(markers.hatchCommentCount).toBe(1);
  });

  it('extracts static + dynamic imports', () => {
    const imports = extractImportSpecifiers([
      "import x from './foo';",
      "export { y } from '../bar';",
      "const z = await import('src/utils/baz');",
      '',
    ].join('\n'));

    expect(imports.sort()).toEqual(['../bar', './foo', 'src/utils/baz']);
  });

  it('parses cli args and validates numeric flags', () => {
    expect(parseCliArgs(['--json', '--top', '15', '--since-days', '90'])).toEqual({
      json: true,
      topN: 15,
      sinceDays: 90,
      help: false,
    });
    expect(parseCliArgs(['--top', '0'])).toBeNull();
    expect(parseCliArgs(['--since-days', 'abc'])).toBeNull();
    expect(parseCliArgs(['--help'])).toEqual({
      json: false,
      topN: 25,
      sinceDays: 180,
      help: true,
    });
  });

  it('flags route write modules lacking nearby integration coverage and tracks test linkage', () => {
    const fixtureRoot = makeFixtureProject();
    const report = buildRiskyModuleDashboardReport({
      projectRoot: fixtureRoot,
      topN: 20,
      sinceDays: 30,
    });

    const byModule = new Map(report.topRiskModules.map(entry => [entry.module, entry]));
    const foo = byModule.get('server/routes/foo.ts');
    const bar = byModule.get('server/routes/bar.ts');
    const helper = byModule.get('server/services/helper.ts');

    expect(foo).toBeDefined();
    expect(foo?.routeWriteHandlers).toBe(1);
    expect(foo?.routeWriteWithoutIntegrationTest).toBe(true);

    expect(bar).toBeDefined();
    expect(bar?.routeWriteHandlers).toBe(1);
    expect(bar?.routeWriteWithoutIntegrationTest).toBe(false);

    expect(helper).toBeDefined();
    expect(helper?.hasTestReference).toBe(true);
    expect((helper?.todoCount ?? 0) + (helper?.hatchCommentCount ?? 0)).toBeGreaterThan(0);
  });
});
