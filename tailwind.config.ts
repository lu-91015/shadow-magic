import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f6',
          100: '#ffe4ef',
          200: '#ffc6dd',
          300: '#ff9ec6',
          400: '#ff6fae',
          500: '#f64f97',
          600: '#e62f7d',
          700: '#c01f63',
          800: '#9b1a52',
          900: '#7d1945',
        },
        ink: {
          900: '#0b0710',
          800: '#140d1c',
          700: '#1d1430',
          600: '#2a1d44',
        },
      },
      fontFamily: {
        round: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        glow: {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        floaty: 'floaty 4s ease-in-out infinite',
        glow: 'glow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
