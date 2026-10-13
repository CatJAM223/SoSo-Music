import ts from 'typescript';

function parse(source) {
  return ts.createSourceFile(
    'fixture.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

export function stripModuleImports(source) {
  const file = parse(source);
  const imports = file.statements.filter(ts.isImportDeclaration);
  for (const declaration of imports.reverse()) {
    source = source.slice(0, declaration.getStart(file)) + source.slice(declaration.end);
  }
  return source;
}

export function extractStatement(source, matches) {
  const file = parse(source);
  let result;
  function visit(node) {
    if (result) return;
    if (ts.isStatement(node) && matches(node.getText(file), node)) {
      result = node.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!result) throw new Error('Production statement was not found');
  return result;
}

export function extractEventRegistration(source, event) {
  return extractStatement(source, (_text, node) => {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    return (
      ts.isPropertyAccessExpression(call.expression) &&
      ['on', 'once', 'handle'].includes(call.expression.name.text) &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text === event
    );
  });
}

export function extractStatementsBetween(source, firstName, lastName) {
  const file = parse(source);
  let result;
  function visit(node) {
    if (ts.isBlock(node)) {
      const named = (statement, name) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => declaration.name.getText(file) === name,
        );
      const start = node.statements.findIndex((statement) => named(statement, firstName));
      const end = node.statements.findIndex(
        (statement, index) => index > start && named(statement, lastName),
      );
      if (start >= 0 && end > start) {
        result = node.statements
          .slice(start, end)
          .map((statement) => statement.getText(file))
          .join('\n');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!result) throw new Error('Production statement range was not found: ' + firstName);
  return result;
}
