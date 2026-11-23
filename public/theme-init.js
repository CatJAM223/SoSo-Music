let scheme = 'dark';
try {
  if (localStorage.getItem('soso_theme') === 'light') scheme = 'light';
} catch {}

document.documentElement.classList.toggle('dark', scheme === 'dark');
document.documentElement.setAttribute('data-theme', scheme);
document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
