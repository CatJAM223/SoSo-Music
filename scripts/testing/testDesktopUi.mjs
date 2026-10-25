import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const scratch = path.join(root, 'scratch');
fs.mkdirSync(scratch, { recursive: true });
const output = fs.mkdtempSync(path.join(scratch, 'ui-regression-'));
const entry = [
  'import packageInfo from "./package.json";window.fixtureAppVersion=packageInfo.version;',
  'import { setLocale } from "./src/shared/i18n/locale";window.fixtureSetLocale=setLocale;',
  'import { WaveControl } from "./src/desktop/ui/components/WaveControl";import { QueueDrawer } from "./src/shared/components/QueueDrawer";',
  'import React from "react"; import { createRoot } from "react-dom/client";',
  'import { DesktopConnectionDialogs } from "./src/desktop/ui/components/DesktopConnectionDialogs";',
  'import { OnboardingTour } from "./src/desktop/ui/components/OnboardingTour"; import { YouTubeAccessDialog } from "./src/desktop/ui/components/YouTubeAccessDialog"; import { SettingsModal } from "./src/desktop/ui/components/modals/SettingsModal";',
  'import { TrackRow } from "./src/desktop/ui/components/TrackRow"; import { setYouTubePlaybackDisabled, isYouTubePlaybackDisabled } from "./src/shared/services/youtubeAvailability";',
  'window.fixtureSetYouTubeDisabled=setYouTubePlaybackDisabled; window.fixtureYouTubeDisabled=isYouTubePlaybackDisabled;',
  'import { LyricsModal as DesktopLyricsModal } from "./src/desktop/ui/components/LyricsModal"; ',
  'const LyricsModal=({layout,...props})=><DesktopLyricsModal {...props}/>;',
  'localStorage.setItem("soso_find_clips","false");',
  'import { PlaybackIssueNotice } from "./src/shared/components/PlaybackIssueNotice";',
  'import { DEFAULT_COVER_SVG_DATA_URI } from "./src/shared/utils/placeholder"; window.fixtureDefaultCover=DEFAULT_COVER_SVG_DATA_URI;',
  'const root=createRoot(document.getElementById("root"));',
  'window.renderArtworkFixture=track=>root.render(<React.StrictMode><TrackRow track={track} index={0} onOpenAddToPlaylist={()=>{}}/></React.StrictMode>);',
  'window.renderNetworkFixture=(kind,autoResume)=>{window.fixtureNetworkActions=[];root.render(<React.StrictMode><PlaybackIssueNotice issue={kind?{kind,autoResume}:null} onRetry={()=>window.fixtureNetworkActions.push("retry")} onPause={()=>window.fixtureNetworkActions.push("pause")}/></React.StrictMode>);};',
  'window.renderFixture=layout=>{window.fixtureKaraokeLayout=layout;window.fixtureAudioState.currentTime=0;root.render(<React.StrictMode><LyricsModal key={layout} layout={layout} isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderConnectionFixture=()=>{let requestListener,connectedListener;window.fixtureResponses=[];window.electronAPI={getLanImportRequest:async()=>null,onLanImportRequest:fn=>{requestListener=fn;return()=>{requestListener=undefined;}},onYouTubeAccountConnected:fn=>{connectedListener=fn;return()=>{connectedListener=undefined;}},respondLanImport:async(id,accepted)=>{window.fixtureResponses.push({id,accepted});requestListener(null);return true;}};window.fixturePush=value=>requestListener(value);window.fixtureConnected=()=>connectedListener();window.fixtureListenersReady=()=>!!requestListener&&!!connectedListener;root.render(<React.StrictMode><DesktopConnectionDialogs/></React.StrictMode>);};',
  'window.renderVideoFixture=layout=>{localStorage.setItem("soso_find_clips","true");window.fixtureVideoMode=true;window.fixtureVideoRequests=[];window.fixtureAudioState.isPlaying=true;root.render(<React.StrictMode><LyricsModal key={"video-"+layout} layout={layout} isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'window.rerenderVideoFixture=layout=>{window.fixtureAudioState.currentTrack={...window.fixtureAudioState.currentTrack,duration:121};root.render(<React.StrictMode><LyricsModal key={"video-"+layout} layout={layout} isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'window.switchClipFixture=(id,open=true)=>{window.fixtureClipId=id;window.fixtureAudioState.currentTrack={...window.fixtureAudioState.currentTrack,id:"yt_"+id,title:id};window.fixtureAudioState.currentTime=0;root.render(<React.StrictMode><LyricsModal key="video-desktop" layout="desktop" isOpen={open} onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderAccessFixture=()=>{window.fixtureAccountConnected=false;window.fixtureAccountChecks=0;window.fixtureSettingsOpened=0;window.electronAPI={getYouTubeAccountStatus:async()=>{window.fixtureAccountChecks++;if(window.fixtureStatusResolver)return window.fixtureStatusResolver();return {connected:window.fixtureAccountConnected,loginOpen:false};},connectYouTubeAccount:async()=>({connected:true,loginOpen:false}),onYouTubeAccountConnected:fn=>{window.fixtureSuccessfulLogin=fn;return()=>{window.fixtureSuccessfulLogin=null;};},onYouTubeAccountChanged:fn=>{window.fixtureAccountChanged=fn;return()=>{window.fixtureAccountChanged=null;};},findZapretConfig:async()=>({found:false})};root.render(<React.StrictMode><YouTubeAccessDialog currentTrackId="yt_access001" onOpenAccountSettings={()=>{window.fixtureSettingsOpened++;root.render(<SettingsModal isOpen={true} initialTab="integrations" onClose={()=>{}}/>);}}/></React.StrictMode>);};',
  'window.renderGatedClipFixture=()=>{window.renderAccessFixture();window.fixtureAudioState.currentTrack={...window.fixtureAudioState.currentTrack,id:"yt_access001"};window.fixtureClipId="gated000001";window.fixtureVideoMode=true;window.fixtureVideoRequests=[];window.fixtureStreamResolver=async()=>{throw Error("Error invoking remote method music:getVideoStream: YOUTUBE_VIDEO_AGE_RESTRICTED");};localStorage.setItem("soso_find_clips","true");root.render(<React.StrictMode><LyricsModal isOpen={true} layout="desktop" onClose={()=>{}}/><YouTubeAccessDialog currentTrackId="yt_access001" onOpenAccountSettings={()=>{}}/></React.StrictMode>);};',
  'window.renderAvailabilityFixture=()=>{window.fixtureTrackClicks=[];const yt={id:"yt_access001",title:"YouTube song",source:"youtube",artist:{name:"Artist"},album:{},duration:100},sc={...yt,id:"sc_access001",title:"SoundCloud song",source:"soundcloud"};root.render(<React.StrictMode><TrackRow track={yt} index={0} onOpenAddToPlaylist={()=>{}}/><TrackRow track={sc} index={1} onOpenAddToPlaylist={()=>{}}/><YouTubeAccessDialog currentTrackId="yt_access001" onOpenAccountSettings={()=>{window.fixtureSettingsOpened++;}}/></React.StrictMode>);};',
  'window.renderLibraryTasteFixture=(mode="data")=>{window.fixtureTasteMode=mode;window.fixtureTasteStarts=0;window.fixtureTasteReads=0;window.fixtureTaste={autoAnalyze:false,running:false,totalTracks:120,processedTracks:120,matchedTracks:105,missingTracks:15,failedTracks:0,updatedAt:Date.now(),genres:[{name:"nu metal",tracks:54,share:.6},{name:"grunge",tracks:35,share:.35}]};if(mode==="rich")window.fixtureTaste.genres=[{name:"rock",tracks:29,share:.81},{name:"punk",tracks:15,share:.51},{name:"grunge",tracks:17,share:.48},{name:"hip hop",tracks:17,share:.48},{name:"alternative rock",tracks:8,share:.35},{name:"pop",tracks:7,share:.30},{name:"post punk",tracks:9,share:.23},{name:"metal",tracks:2,share:.10},{name:"rnb",tracks:2,share:.10},{name:"shoegaze",tracks:2,share:.10},{name:"ambient",tracks:1,share:.05},{name:"emo",tracks:1,share:.05}];if(mode==="empty")window.fixtureTaste={...window.fixtureTaste,totalTracks:0,processedTracks:0,matchedTracks:0,missingTracks:0,updatedAt:null,genres:[]};window.electronAPI={...window.electronAPI,getLibraryTaste:async()=>{window.fixtureTasteReads++;if(window.fixtureTasteMode==="error")throw Error("Fixture Last.fm error");return window.fixtureTaste;},analyzeLibraryTaste:async()=>{window.fixtureTasteStarts++;return(window.fixtureTaste={...window.fixtureTaste,running:true,processedTracks:60});},cancelLibraryTaste:async()=> (window.fixtureTaste={...window.fixtureTaste,running:false,processedTracks:120}),setLibraryTasteAutoAnalyze:async autoAnalyze=>(window.fixtureTaste={...window.fixtureTaste,autoAnalyze})};root.render(<React.StrictMode><SettingsModal key={"lastfm-"+mode} isOpen={true} initialTab="stats" onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderSettingsFixture=()=>{window.fixtureLastFmKeyConfigured=true;window.electronAPI.getLastFmApiKeyStatus=async()=>({configured:window.fixtureLastFmKeyConfigured});window.electronAPI.saveLastFmApiKey=async key=>{window.fixtureLastFmKeyConfigured=!!key;return {configured:!!key};};window.fixtureRefreshChecks=0;window.electronAPI.getYouTubeAccountStatus=async()=>({connected:true,loginOpen:false});window.electronAPI.refreshYouTubeSession=()=>{window.fixtureRefreshChecks++;return new Promise(resolve=>{window.fixtureFinishRefresh=resolve;});};window.fixtureUpdateChecks=0;window.fixtureUpdateStatus={status:"no-release",currentVersion:"3.0.5",message:"В репозитории пока нет опубликованных релизов."};window.electronAPI.checkAppUpdates=async()=>{window.fixtureUpdateChecks++;return window.fixtureUpdateStatus;};root.render(<React.StrictMode><SettingsModal isOpen={true} initialTab="general" onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderTourFixture=()=>{window.fixtureTourClosed=0;window.fixtureOverlayEnabled=true;window.fixtureOverlayPreferenceCalls=[];window.electronAPI={getDesktopControls:async()=>({shortcuts:DEFAULT_SHORTCUTS,unavailable:[],overlayEnabled:window.fixtureOverlayEnabled}),setPlayerOverlayEnabled:async value=>{window.fixtureOverlayPreferenceCalls.push(value);window.fixtureOverlayEnabled=value;return {shortcuts:DEFAULT_SHORTCUTS,unavailable:[],overlayEnabled:value};},findZapretConfig:async()=>({found:true,path:"fixture/list-general.txt",hasSoundcloud:true,hasSndcdn:true,hasSoundcloudCloud:false}),applyZapretDomains:async()=>{window.fixtureDomainsApplied=true;return {success:true,message:"Домены добавлены"};}};root.render(<React.StrictMode><OnboardingTour isOpen={true} onClose={()=>{window.fixtureTourClosed++;root.render(<div/>);}}/></React.StrictMode>);};',
  'window.setKaraokeClock=(time,playing=false)=>{window.fixtureAudioState.currentTime=time;window.fixtureAudioState.isPlaying=playing;root.render(<React.StrictMode><LyricsModal key={window.fixtureKaraokeLayout} layout={window.fixtureKaraokeLayout} isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderWaveQueueFixture=()=>{const track=(id,title)=>({id,title,source:"soundcloud",artist:{name:"Русский исполнитель"},album:{},duration:100});const tracks=[track("old","Old"),track("current","Моя волна"),track("next","Следующая песня")];Object.assign(window.fixtureAudioState,{currentTrack:tracks[1],queue:tracks,queueIndex:1,isWaveActive:true,isShuffle:false,repeatMode:"all",shuffledUpcomingIndices:[]});root.render(<React.StrictMode><WaveControl mood="mix" source="all" isActive={false} isPlaying={false} isLoading={false} isStarting={false} onToggle={()=>{}} onSelectSource={()=>{}} onSelectMood={()=>{}} onReset={()=>{}}/><QueueDrawer isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'import {PlayerOverlay} from "./src/desktop/ui/components/PlayerOverlay";import {DEFAULT_OVERLAY_LAYOUT,DEFAULT_SHORTCUTS} from "./src/shared/utils/desktopControls";',
  'window.renderOverlayFixture=()=>{window.fixtureOverlayCommands=[];window.fixtureOverlayLayout??=structuredClone(DEFAULT_OVERLAY_LAYOUT);window.fixtureOverlayState={track:{id:"overlay-song",title:"Overlay song",artist:{name:"Overlay artist"},album:{},duration:200},isPlaying:true,currentTime:15,duration:200,isLiked:false,volume:1};Object.assign(window.electronAPI,{getOverlayState:async()=>window.fixtureOverlayState,getOverlayLayout:()=>window.fixtureOverlayLayoutRequest?window.fixtureOverlayLayoutRequest():Promise.resolve(structuredClone(window.fixtureOverlayLayout)),saveOverlayLayout:async value=>(window.fixtureOverlayLayout=structuredClone(value)),getOverlayEditing:async()=>!!window.fixtureOverlayEditing,finishOverlayEditing:async()=>{window.fixtureOverlayEditing=false;window.fixtureOverlayModeListener?.(false);return false;},onOverlayEditingChanged:fn=>{window.fixtureOverlayModeListener=fn;return()=>{window.fixtureOverlayModeListener=null;};},togglePlayerOverlay:async()=>{window.fixtureOverlayClosed=true;return false;},onWidgetStateUpdate:fn=>{window.fixtureOverlayListener=fn;return()=>{window.fixtureOverlayListener=null;};},sendWidgetCommand:command=>window.fixtureOverlayCommands.push(command)});root.render(<React.StrictMode><PlayerOverlay key={Date.now()}/></React.StrictMode>);};',
  'window.fixtureSetupShortcuts=()=>{window.fixtureOverlayEnabled=true;window.fixtureShortcutCalls=[];Object.assign(window.electronAPI,{getDesktopControls:async()=>({shortcuts:{...DEFAULT_SHORTCUTS},unavailable:[],overlayEnabled:window.fixtureOverlayEnabled!==false}),captureDesktopShortcut:async value=>{window.fixtureShortcutCapture=value;return {shortcuts:DEFAULT_SHORTCUTS,unavailable:[],overlayEnabled:window.fixtureOverlayEnabled!==false};},setDesktopShortcut:async(action,key)=>{window.fixtureShortcutCalls.push({action,key});return {shortcuts:{...DEFAULT_SHORTCUTS,[action]:key},unavailable:[],overlayEnabled:window.fixtureOverlayEnabled!==false};},togglePlayerOverlay:async()=>true,editPlayerOverlay:async()=>{window.fixtureOverlayEditing=true;return true;}});};',
  'import {useAppUpdateNotice} from "./src/desktop/ui/hooks/useAppUpdateNotice";import {AppUpdateNotice} from "./src/desktop/ui/components/AppUpdateNotice";',
  'function UpdateDemo(){const {update,dismiss}=useAppUpdateNotice();return <><div className="fixture-playing-bar" style={{position:"fixed",bottom:0,height:92,left:0,right:0,background:"#111",color:"white",padding:20}}>Текущий трек · воспроизведение продолжается</div>{update&&<AppUpdateNotice update={update} onDismiss={dismiss}/>}</>;}',
  'window.renderUpdateFixture=()=>{localStorage.removeItem("soso_update_dismissed_version");window.fixtureUpdateListener=null;Object.assign(window.electronAPI,{getAvailableAppUpdate:async()=>null,onAppUpdateAvailable:fn=>{window.fixtureUpdateListener=fn;return()=>window.fixtureUpdateListener=null;}});root.render(<React.StrictMode><UpdateDemo/></React.StrictMode>);};',
  'window.renderRichQueueFixture=()=>{window.fixtureQueuePlayCalls=[];const track=(id,title,artist)=>({id,title,source:"youtube",artist:{name:artist},album:{},duration:200});Object.assign(window.fixtureAudioState,{currentTrack:track("current","Heart-Shaped Box","Nirvana"),queue:[track("current","Heart-Shaped Box","Nirvana"),track("next","Hate.","ThxSoMch"),track("later","Drain You","Nirvana"),track("last","Animal I Have Become","Three Days Grace")],queueIndex:0,isWaveActive:true,isShuffle:false,repeatMode:"all",shuffledUpcomingIndices:[]});root.render(<React.StrictMode><QueueDrawer isOpen={true} onClose={()=>{}}/></React.StrictMode>);};',
  'window.renderFixture("desktop");',
].join('\n');
try {
  await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: root },
    bundle: true,
    jsx: 'automatic',
    platform: 'browser',
    loader: { '.png': 'file', '.svg': 'file', '.webp': 'file' },
    outfile: path.join(output, 'fixture.js'),
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'mock-services-only',
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /(?:context\/(?:AudioContext|ThemeContext|ToastContext)|bridge\/platformBridge)$/,
            },
            (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture-services' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture-services' }, (args) => {
            if (args.path.endsWith('AudioContext'))
              return {
                contents: [
                  'const track={id:"yt_fixture1234",title:"Fixture song",artist:{name:"Fixture artist"},duration:120,album:{}};',
                  'const state={currentTrack:track,currentTime:0,duration:120,isPlaying:false,crossfadeDuration:4,likedTrackIds:new Set(),seek(){},togglePlay(){},getPlaybackTime:()=>{window.fixtureKaraokeClockRead=state.currentTime;return state.currentTime;}};',
                  'window.fixtureAudioState=state; export const useAudio=()=>state; export const useAudioState=()=>state;export const useAudioProgress=()=>({snippetProgress:0});export const useAudioControls=()=>({playTrack:(t,q,wave)=>{window.fixtureTrackClicks?.push(t.id);window.fixtureQueuePlayCalls?.push({id:t.id,wave});},togglePlay(){},previewSnippet(){},stopSnippet(){},toggleLike(){},isOfflineCached:()=>false,cacheTrackForOffline:async()=>false,removeOfflineCachedTrack:async()=>false,refreshLikedTracks:async()=>{},refreshSavedAlbums:async()=>{},refreshFollowedArtists:async()=>{},setCrossfadeDuration(){},toggleVolumeNormalization(){}});',
                ].join('\n'),
                loader: 'js',
              };
            if (args.path.endsWith('ThemeContext'))
              return {
                contents:
                  'export const useTheme=()=>({accentColor:"yellow",themeMode:"dark"}); export const THEME_OPTIONS=[]; export const EASTER_EGG_THEME_OPTION={id:"fixture",name:"Fixture",label:"Fixture"}; export const ACCENT_COLOR_OPTIONS=[{id:"yellow",color:"#eab308",rgb:"234, 179, 8"}];',
                loader: 'js',
              };
            if (args.path.endsWith('ToastContext'))
              return { contents: 'export const emitToast=()=>{};', loader: 'js' };
            return {
              contents:
                'export const platformBridge={getTastePolicy:async()=>({revision:0,exclusions:[]}),onTastePolicyChanged:()=>()=>{},getLyrics:async()=>[{time:12,text:"First lyric"},{time:20,text:"Second lyric"},{time:30,text:"Third lyric"}],getChords:async()=>null,getSongsterrTab:async()=>null,getListeningHistory:async()=>[],getStats:async()=>null,getLanSyncStatus:async()=>({active:false,addresses:[]}),onLanSyncImported:()=>()=>{},getOfficialVideoClip:async()=>window.fixtureVideoMode?(window.fixtureClipId||"fixture1234"):null,getVideoStream:async(id,options)=>{window.fixtureVideoRequests.push({id,options});if(window.fixtureStreamResolver)return window.fixtureStreamResolver(id,options);return window.fixtureVideoRequests.length===1?"":window.fixtureVideoUrl;}};',
              loader: 'js',
            };
          });
        },
      },
    ],
  });
  const css = await postcss([tailwind({ base: root })]).process(
    fs.readFileSync(path.join(root, 'src/renderer/index.css'), 'utf8'),
    {
      from: path.join(root, 'src/renderer/index.css'),
    },
  );
  fs.writeFileSync(
    path.join(output, 'fixture.css'),
    css.css +
      '\n' +
      [
        'src/shared/components/settings/settings.css',
        'src/shared/components/TasteExclusionsSettings.css',
        'src/shared/components/settings/SettingsLibraryTaste.css',
        'src/shared/components/settings/LibraryGenreChart.css',
        'src/desktop/ui/components/DesktopConnectionDialogs.css',
        'src/desktop/ui/components/OnboardingTour.css',
        'src/desktop/ui/components/WaveControl.css',
        'src/desktop/ui/components/PlayerOverlay.css',
        'src/shared/components/QueueDrawer.css',
        'src/desktop/ui/components/AppUpdateNotice.css',
        'src/desktop/ui/components/modals/SettingsModal.css',
        'src/desktop/ui/components/modals/SettingsShortcuts.css',
        'src/desktop/ui/components/YouTubeAccessDialog.css',
      ]
        .map((p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^@import[^;]+;/gm, ''))
        .join('\n'),
  );
  fs.cpSync(path.join(root, 'public/fonts'), path.join(output, 'fonts'), { recursive: true });
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>',
  );
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(root, 'scripts/testing/desktopUiProbe.cjs'), output],
    { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 45000, env: electronEnv },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('Desktop UI regression failed with exit ' + result.status);
} finally {
  if (path.dirname(output) !== scratch || !path.basename(output).startsWith('ui-regression-'))
    throw new Error('Unexpected test output path');
  fs.rmSync(output, { recursive: true, force: true });
}
