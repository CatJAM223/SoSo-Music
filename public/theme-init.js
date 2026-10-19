try {
  const savedTheme = localStorage.getItem('soso_theme') || 'dark';
  document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  document.documentElement.setAttribute('data-theme', savedTheme === 'dark' ? 'dark' : 'light');
} catch {}
