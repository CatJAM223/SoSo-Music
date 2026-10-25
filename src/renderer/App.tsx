import React, { useEffect, lazy, Suspense } from 'react';
import { CatLoader } from '../shared/components/CatLoader';
const DesktopApp = lazy(() =>
  import('../desktop/ui/DesktopApp').then((module) => ({ default: module.DesktopApp })),
);
// This effect commits only after the lazy application has resolved inside Suspense.
function ReadyDesktopApp() {
  useEffect(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) preloader.remove();
      else {
        preloader.classList.add('is-ready');
        timer = setTimeout(() => preloader.remove(), 240);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      preloader.classList.remove('is-ready');
    };
  }, []);
  return <DesktopApp />;
}
export const App: React.FC = () => (
  <Suspense fallback={<CatLoader size="fullscreen" message="Загрузка…" />}>
    <ReadyDesktopApp />
  </Suspense>
);
