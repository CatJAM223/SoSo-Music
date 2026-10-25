/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        soso: {
          brand: 'rgb(var(--theme-accent-rgb, 34, 197, 94) / <alpha-value>)',
          'brand-light': 'rgb(var(--theme-accent-rgb, 34, 197, 94) / <alpha-value>)',
          'brand-dark': 'rgb(var(--theme-accent-rgb, 34, 197, 94) / <alpha-value>)',
          black: '#121212',
          darker: '#0a0a0a',
          card: '#181818',
          'card-hover': '#282828',
          subtext: '#b3b3b3',
          border: '#2a2a2a',
        },
        light: {
          bg: '#f8fafc',
          sidebar: '#f1f5f9',
          card: '#ffffff',
          'card-hover': '#f8fafc',
          text: '#0f172a',
          subtext: '#64748b',
          border: '#e2e8f0',
        },
      },
      transitionDuration: {
        instant: '100ms',
        fast: '200ms',
        normal: '300ms',
        slow: '500ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
        bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      fontFamily: {
        sans: ['Poppins', 'Roboto', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        soundwave: {
          '0%, 100%': { height: '4px' },
          '50%': { height: '14px' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fade-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'spring-in': 'fade-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'sheet-in': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-subtle': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-slow': 'pulse 2.4s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        'soundwave-1': 'soundwave 1s ease-in-out infinite 0.1s',
        'soundwave-2': 'soundwave 1s ease-in-out infinite 0.35s',
        'soundwave-3': 'soundwave 1s ease-in-out infinite 0.2s',
      },
    },
  },
  plugins: [],
};
