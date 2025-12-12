/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        night: '#0b1220',
        primary: '#3b82f6',
        success: '#22c55e',
        warning: '#fbbf24',
        danger: '#ef4444',
      },
      boxShadow: {
        soft: '0 10px 40px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
}

