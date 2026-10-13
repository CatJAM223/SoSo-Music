import React, { useEffect, lazy, Suspense } from 'react';
import { CatLoader } from '../shared/components/CatLoader';
const DesktopApp = lazy(() =>
  import('../desktop/ui/DesktopApp').then((module) => ({ default: module.DesktopApp })),
);
export const App: React.FC = () => {
  useEffect(() => {
    const preloader = document.getElementById('app-preloader');
    if (!preloader) return;
    preloader.style.transition = 'opacity 0.35s ease-out';
    preloader.style.opacity = '0';
    const timer = window.setTimeout(() => preloader.remove(), 350);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Suspense fallback={<CatLoader size="fullscreen" message="Загрузка…" />}>
      <DesktopApp />
    </Suspense>
  );
};
