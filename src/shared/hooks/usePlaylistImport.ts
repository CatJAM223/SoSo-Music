import { useEffect, useRef, useState } from 'react';
import { platformBridge } from '../bridge/platformBridge.ts';
import { parsePlaylistLink } from '../services/externalPlaylist.ts';
import { matchImportedPlaylist, saveImportedPlaylist } from '../services/playlistImport.ts';
import type { ExternalPlaylist, ImportMatch, ImportSearchSource } from '../types/playlistImport.ts';

type ImportState = {
  phase: 'idle' | 'loading' | 'ready' | 'matching' | 'review' | 'saving' | 'saved';
  playlist?: ExternalPlaylist;
  matches: ImportMatch[];
  completed: number;
  error: string;
  needsVkLogin: boolean;
  waitingForVk?: boolean;
  savedCount: number;
  priority?: ImportSearchSource;
};
const initialState: ImportState = {
  phase: 'idle',
  matches: [],
  completed: 0,
  error: '',
  needsVkLogin: false,
  savedCount: 0,
};

export function usePlaylistImport(onSaved: () => void) {
  const [state, setState] = useState<ImportState>(initialState);
  const controller = useRef<AbortController | null>(null);
  const vkLoginActive = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (vkLoginActive.current) void platformBridge.cancelVkPlaylistRead();
    };
  }, []);

  async function load(url: string, login = false) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    let isVk = false;
    try {
      isVk = parsePlaylistLink(url).source === 'vk';
    } catch (error) {
      setState({
        ...initialState,
        error: error instanceof Error ? error.message : 'Проверьте ссылку',
      });
      return;
    }
    const useVkWindow = isVk && platformBridge.canOpenVkImportWindow;
    const openLogin = login || useVkWindow;
    setState({ ...initialState, phase: 'loading', waitingForVk: openLogin });
    vkLoginActive.current = openLogin;
    try {
      const result = await (openLogin
        ? platformBridge.readVkPlaylistInWindow(url)
        : platformBridge.readExternalPlaylist(url));
      if (!mounted.current || current.signal.aborted) return;
      if (result.success) setState({ ...initialState, phase: 'ready', playlist: result.data });
      else
        setState({
          ...initialState,
          error: result.error,
          needsVkLogin: isVk && result.code === 'access',
        });
    } catch (error) {
      if (mounted.current && !current.signal.aborted)
        setState({
          ...initialState,
          error: error instanceof Error ? error.message : 'Не удалось загрузить плейлист',
        });
    } finally {
      if (controller.current === current) vkLoginActive.current = false;
    }
  }

  async function match(priority: ImportSearchSource) {
    if (!state.playlist) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState((previous) => ({
      ...previous,
      phase: 'matching',
      priority,
      matches: [],
      completed: 0,
      error: '',
    }));
    try {
      const matches = await matchImportedPlaylist(
        state.playlist,
        priority,
        platformBridge.search,
        (results, completed) => {
          if (mounted.current && !current.signal.aborted)
            setState((previous) => ({ ...previous, matches: results, completed }));
        },
        current.signal,
      );
      if (mounted.current && !current.signal.aborted)
        setState((previous) => ({ ...previous, phase: 'review', matches }));
    } catch (error) {
      if (!mounted.current) return;
      setState((previous) => ({
        ...previous,
        phase: 'review',
        error: current.signal.aborted
          ? 'Поиск остановлен. Можно сохранить обработанные треки или запустить подбор заново.'
          : 'Поиск прервался. Попробуйте повторить подбор.',
      }));
    }
  }

  function stop() {
    controller.current?.abort();
    if (vkLoginActive.current) void platformBridge.cancelVkPlaylistRead();
    if (state.phase === 'loading') setState(initialState);
  }

  function select(index: number, candidateKey: string) {
    setState((previous) => {
      const item = previous.matches[index];
      if (!item) return previous;
      const selected = item.candidates.find(
        (track) => `${track.source}:${track.id}` === candidateKey,
      );
      const matches = previous.matches.slice();
      matches[index] = { ...item, track: selected };
      return { ...previous, matches };
    });
  }

  async function save(name: string) {
    if (!state.playlist || state.phase !== 'review') return;
    setState((previous) => ({ ...previous, phase: 'saving', error: '' }));
    try {
      const result = await saveImportedPlaylist(
        name,
        state.playlist,
        state.matches,
        platformBridge,
      );
      if (mounted.current) {
        setState((previous) => ({ ...previous, phase: 'saved', savedCount: result.count }));
        onSaved();
      }
    } catch (error) {
      if (mounted.current)
        setState((previous) => ({
          ...previous,
          phase: 'review',
          error: error instanceof Error ? error.message : 'Не удалось сохранить плейлист',
        }));
    }
  }

  return { state, actions: { load, match, stop, select, save } };
}
