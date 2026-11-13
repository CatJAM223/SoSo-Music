These PNGs are frames of SoSo Music's actual background renderers, not generated artwork.

Regenerate after changing the backgrounds with:

    node scripts/desktop/renderThemePreviews.mjs

The script renders BlackHoleBackground, ListeningSceneBackground, SakuraFallingPetals and
WeatherEffects with the real theme CSS in an isolated, hidden Electron window (768 × 432).
Standard light/dark themes intentionally show their plain backgrounds. Weather has separate
clear/rain frames. User wallpaper is read directly from the selected local media in SettingsAppearance.
Static previews avoid running multiple background animations while settings are open.
