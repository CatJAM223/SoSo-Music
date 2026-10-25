import ts from 'typescript';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
/** Observe the required production Rust call, never substitute another algorithm. */
export async function waveComputeFixture(mutation = '') {
  if (
    ![
      '',
      'bypass-rust',
      'ignore-history',
      'ignore-offered',
      'ignore-duplicates',
      'reject-ranking',
    ].includes(mutation)
  )
    throw Error('Unknown compute mutation');
  let applied = 0;
  const result = await build({
    stdin: {
      resolveDir: root,
      contents: `
    export {sequenceWaveTracks,resequenceWaveQueue} from './src/shared/utils/waveQueue.ts';
    export {initializeRustCompute,computeObservations} from './src/shared/compute/rustCore.ts';
  `,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'observe-required-rust',
        setup(builder) {
          builder.onLoad({ filter: /rustCore\.ts$/ }, ({ path }) => {
            let contents = fs.readFileSync(path, 'utf8');
            const anchor = 'export function runRustCompute(';
            if (!contents.includes(anchor)) throw Error('Rust observation anchor missing');
            contents = contents.replace(anchor, 'function observedRunRustCompute(');
            const altered =
              mutation === 'bypass-rust'
                ? 'return new Uint8Array();'
                : mutation === 'reject-ranking'
                  ? "throw Error('Forced Rust rejection');"
                  : '';
            contents += `
          export const computeObservations={calls:0,rustBatches:0,matrices:0,comparisons:0};
          export function runRustCompute(...args:Parameters<typeof observedRunRustCompute>){
            if(args[0]==='sequence_wave'){computeObservations.calls++;${altered}}
            const result=observedRunRustCompute(...args);
            if(args[0]==='sequence_wave')computeObservations.rustBatches++;
            if(args[0]==='calculate')computeObservations.matrices++;
            if(args[0]==='compare_songs')computeObservations.comparisons++;
            return result;
          }`;
            if (altered) applied++;
            return { contents, loader: 'ts' };
          });
          if (['ignore-history', 'ignore-offered', 'ignore-duplicates'].includes(mutation))
            builder.onLoad({ filter: /waveSequence\.ts$/ }, ({ path }) => {
              let contents = fs.readFileSync(path, 'utf8');
              if (mutation === 'ignore-history')
                contents = contents.replace(/options\.recentTracks\s*\|\|\s*\[\]/, '[]');
              if (mutation === 'ignore-offered')
                contents = contents.replace(/options\.offeredTracks\s*\|\|\s*\[\]/, '[]');
              if (mutation === 'ignore-duplicates') {
                const file = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
                let expression;
                function visit(node) {
                  if (ts.isCallExpression(node) && node.expression.getText(file) === 'encodeSongs')
                    expression = node.arguments[0];
                  ts.forEachChild(node, visit);
                }
                visit(file);
                if (!expression) throw Error('Song packet mutation anchor missing');
                contents =
                  contents.slice(0, expression.getStart(file)) +
                  `all.map((t,i)=>buildWaveSongIdentity({...t,title:'MutantUniqueTitle '+i+' xxxxx'},known))` +
                  contents.slice(expression.end);
              }
              applied++;
              return { contents, loader: 'ts' };
            });
        },
      },
    ],
  });
  if (mutation && applied !== 1) throw Error('Compute mutation must apply once');
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text + '\n// ' + crypto.randomUUID()).toString('base64')
  );
}
