/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)', raised: 'var(--bg-raised)', overlay: 'var(--bg-overlay)',
        inset: 'var(--bg-inset)', line: 'var(--line)', ink: 'var(--text-hi)',
        copy: 'var(--text)', muted: 'var(--text-lo)', confirmed: 'var(--confirmed)',
        pending: 'var(--pending)', ripcord: 'var(--ripcord)', info: 'var(--info)',
      },
      fontFamily: { sans: ['var(--font-sans)'], mono: ['var(--font-mono)'] },
      borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
    },
  },
  plugins: [],
};
