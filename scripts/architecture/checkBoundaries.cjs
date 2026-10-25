'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const builtin = new Set(
  require('node:module').builtinModules.map((name) => name.replace(/^node:/, '')),
);
function walk(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walk(file);
    return /\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')
      ? [file]
      : [];
  });
}
function imports(file) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = [];
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      (!node.importClause?.namedBindings ||
        !ts.isNamedImports(node.importClause.namedBindings) ||
        node.importClause.name ||
        node.importClause.namedBindings.elements.some((item) => !item.isTypeOnly))
    ) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}
function targetFor(root, file, specifier) {
  const base = specifier.startsWith('.')
    ? path.resolve(path.dirname(file), specifier)
    : specifier.startsWith('@/')
      ? path.join(root, 'src', specifier.slice(2))
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx'].map(
      (extension) => base + extension,
    ),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return path.relative(root, candidate).replaceAll(path.sep, '/');
  }
  return path.relative(root, base).replaceAll(path.sep, '/');
}
function violation(from, target, specifier) {
  // Assets may be shared; implementation modules may not cross the following boundaries.
  if (from.startsWith('src/') && target?.startsWith('tests/'))
    return 'production cannot import historical test algorithms';
  if (target && !/\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(target)) return null;
  if (
    from.startsWith('src/desktop/main/') &&
    (target?.startsWith('src/mobile/') ||
      target?.startsWith('src/desktop/ui/') ||
      target?.startsWith('src/renderer/') ||
      /^src\/shared\/(?:components|hooks|context)\//.test(target || '') ||
      /^react(?:-dom)?(?:\/|$)/.test(specifier))
  )
    return 'main cannot import a renderer or mobile implementation';
  if (
    from.startsWith('src/desktop/preload/') &&
    target &&
    (target.startsWith('src/desktop/main/') ||
      target.startsWith('src/desktop/ui/') ||
      target.startsWith('src/mobile/'))
  )
    return 'preload must expose contracts, not import services';
  if (
    (from.startsWith('src/desktop/ui/') ||
      from.startsWith('src/renderer/') ||
      from.startsWith('src/mobile/')) &&
    (specifier === 'electron' || builtin.has(specifier.replace(/^node:/, '')))
  )
    return 'renderer cannot import Electron or Node runtime';
  if (from.startsWith('src/mobile/') && target?.startsWith('src/desktop/'))
    return 'mobile cannot import desktop implementation';
  if (from.startsWith('src/shared/')) {
    if (specifier === 'electron' || builtin.has(specifier.replace(/^node:/, '')))
      return 'shared code cannot import Electron or Node runtime';
    if (target?.startsWith('src/desktop/'))
      return 'shared code cannot import desktop implementation';
    // Current platform composition is isolated to this bridge; migrate adapters here incrementally.
    if (target?.startsWith('src/mobile/'))
      return 'desktop shared code cannot import mobile adapters';
  }
  return null;
}
function check(root) {
  const files = walk(path.join(root, 'src')),
    issues = [];
  let edges = 0;
  for (const file of files) {
    const from = path.relative(root, file).replaceAll(path.sep, '/');
    for (const specifier of imports(file)) {
      edges++;
      const target = targetFor(root, file, specifier);
      const reason = violation(from, target, specifier);
      if (reason) issues.push({ from, specifier, reason });
    }
  }
  return { files: files.length, edges, issues };
}
if (require.main === module) {
  const report = check(path.resolve(__dirname, '../..'));
  if (report.issues.length) {
    for (const issue of report.issues)
      console.error(issue.from + ' -> ' + issue.specifier + ': ' + issue.reason);
    process.exitCode = 1;
  } else
    console.log(
      'Architecture boundaries OK: ' + report.files + ' modules, ' + report.edges + ' imports.',
    );
}
module.exports = { check, imports, violation, targetFor };
