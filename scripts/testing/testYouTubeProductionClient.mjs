// Run after npm run build: verify the lazy YouTube adapter inside the actual production bundle.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  require = createRequire(import.meta.url),
  dist = path.join(root, 'dist-electron');
const active = new Set(),
  pending = ['main.js'];
let adapter;
while (pending.length) {
  const name = pending.pop();
  if (active.has(name)) continue;
  active.add(name);
  const source = fs.readFileSync(path.join(dist, name), 'utf8');
  if (source.includes('exports.parseYouTubeAccountWatchInfo=')) adapter = path.join(dist, name);
  for (const match of source.matchAll(/require\(["']\.\/([^"']+\.js)["']\)/g))
    pending.push(match[1]);
}
if (!adapter) throw Error('Production build is missing the active YouTube watch-response adapter');
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const out = fs.mkdtempSync(path.join(scratch, 'youtube-production-client-'));
const probe = String.raw`
const{app,session}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));const timer=setTimeout(()=>app.exit(1),15000);
app.whenReady().then(async()=>{
 const external=[];session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/.test(details.url))external.push(new URL(details.url).origin);callback({cancel:true});});
 globalThis.fetch=async()=>{throw Error('Production parser check must remain offline');};
 const adapter=require(process.argv[2]);for(const name of['createYouTubeAccountClient','createYouTubeAccountPlayer','parseYouTubeAccountWatchInfo'])assert.equal(typeof adapter[name],'function','Missing production export '+name);
 const client=await adapter.createYouTubeAccountClient({cookie:'SAPISID=synthetic; SID=synthetic',generate_session_locally:true,retrieve_player:false,retrieve_innertube_config:false,enable_session_cache:false},()=>assert.fail('No remote script should be evaluated'));
 const response={playabilityStatus:{status:'OK'},videoDetails:{videoId:'W0LiTBNjJ_o',lengthSeconds:'106'},streamingData:{expiresInSeconds:'3600',adaptiveFormats:[{itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',bitrate:128000,audioQuality:'AUDIO_QUALITY_MEDIUM',url:'https://rr1.googlevideo.com/videoplayback?itag=140'}]}};
 const parsed=adapter.parseYouTubeAccountWatchInfo(response,client.actions);assert.equal(parsed.basic_info.id,'W0LiTBNjJ_o');assert.equal(parsed.basic_info.duration,106);assert.equal(parsed.playability_status.status,'OK');assert.equal(typeof parsed.streaming_data.adaptive_formats[0].decipher,'function');assert.equal(await parsed.streaming_data.adaptive_formats[0].decipher(),'https://rr1.googlevideo.com/videoplayback?itag=140');
 const denied=adapter.parseYouTubeAccountWatchInfo({playabilityStatus:{status:'LOGIN_REQUIRED',reason:'Sign in'},videoDetails:{videoId:'W0LiTBNjJ_o'}},client.actions);assert.equal(denied.playability_status.status,'LOGIN_REQUIRED');assert.equal(external.length,0);
 console.log('YOUTUBE_PRODUCTION_CLIENT_OK '+JSON.stringify({node:process.versions.node,adapter:path.basename(process.argv[2]),parsedRecording:parsed.basic_info.id,formatPrototypePreserved:true,denialPreserved:true,externalRequests:external.length}));clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timer);app.exit(1);});`;
fs.writeFileSync(path.join(out, 'probe.cjs'), probe);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.join(out, 'probe.cjs'), adapter], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: 'inherit',
  timeout: 20000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
