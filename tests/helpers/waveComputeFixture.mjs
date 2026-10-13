import ts from 'typescript';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
// Bundle the entire production graph fresh. Observe real results; matching and queue logic stay unchanged.
export async function waveComputeFixture(mutation = '') {
  if (
    !['', 'bypass-rust', 'ignore-history', 'ignore-duplicates', 'ignore-offered'].includes(mutation)
  )
    throw Error('Unknown isolated test mutation: ' + mutation);
  let mutations = 0;
  const result = await build({
    stdin: {
      resolveDir: root,
      contents:
        "export {sequenceWaveTracks} from './src/shared/utils/waveQueue.ts';export {initializeRustCompute,computeObservations} from './src/shared/compute/waveSongMatrix.ts';",
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'observe-real-compute',
        setup(builder) {
          builder.onLoad({ filter: /waveSongMatrix\.ts$/ }, (args) => {
            let contents = fs.readFileSync(args.path, 'utf8');
            const declaration = 'export function createWaveSongMatrix(';
            if (!contents.includes(declaration)) throw Error('Compute observation anchor missing');
            contents = contents.replace(declaration, 'function observedCreateWaveSongMatrix(');
            contents += [
              'export const computeObservations={calls:0,rustBatches:0,heard:0,offered:0,pairs:0};',
              'export function createWaveSongMatrix(...args:Parameters<typeof observedCreateWaveSongMatrix>){',
              'computeObservations.calls++;const matrix=observedCreateWaveSongMatrix(...args);if(!matrix)return null;computeObservations.rustBatches++;return {',
              'wasHeard(index:number){computeObservations.heard++;return ' +
                (mutation === 'ignore-history' ? 'false' : 'matrix.wasHeard(index)') +
                ';},',
              'wasOffered(index:number){computeObservations.offered++;return ' +
                (mutation === 'ignore-offered' ? 'false' : 'matrix.wasOffered(index)') +
                ';},',
              'sameSong(left:number,right:number){computeObservations.pairs++;return ' +
                (mutation === 'ignore-duplicates' ? 'false' : 'matrix.sameSong(left,right)') +
                ';}',
              '};}',
            ].join('\n');
            if (mutation && mutation !== 'bypass-rust') mutations++;
            return { contents, loader: 'ts' };
          });
          if (mutation === 'bypass-rust')
            builder.onLoad({ filter: /waveQueue\.ts$/ }, (args) => {
              const contents = fs.readFileSync(args.path, 'utf8');
              const file = ts.createSourceFile(args.path, contents, ts.ScriptTarget.Latest, true);
              let initializer;
              function visit(node) {
                if (
                  ts.isVariableDeclaration(node) &&
                  node.name.getText(file) === 'matrix' &&
                  node.initializer &&
                  ts.isCallExpression(node.initializer) &&
                  node.initializer.expression.getText(file) === 'createWaveSongMatrix'
                ) {
                  if (initializer) throw Error('Ambiguous Rust integration mutation');
                  initializer = node.initializer;
                }
                ts.forEachChild(node, visit);
              }
              visit(file);
              if (!initializer) throw Error('Rust integration mutation anchor missing');
              mutations++;
              return {
                contents:
                  contents.slice(0, initializer.getStart(file)) +
                  'null' +
                  contents.slice(initializer.end),
                loader: 'ts',
              };
            });
        },
      },
    ],
  });
  if (mutation && mutations !== 1) throw Error('Mutation was not applied exactly once');
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text + '\n// isolated ' + crypto.randomUUID()).toString(
        'base64',
      )
  );
}
