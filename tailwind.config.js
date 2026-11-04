// Configuração do Tailwind do site dos alunos: onde procurar as classes usadas,
// modo escuro pela classe "dark" no <html> e a paleta/fontes do PrintFlow.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e8f5e9',
          100: '#c8e6c9',
          200: '#a5d6a7',
          300: '#81c784',
          400: '#66bb6a',
          500: '#2E7D32',
          600: '#1B5E20',
          700: '#145214',
          800: '#0d3b0d',
          900: '#072407',
        },
        secondary: {
          50: '#e3f2fd',
          100: '#bbdefb',
          200: '#90caf9',
          300: '#64b5f6',
          400: '#42a5f5',
          500: '#1565C0',
          600: '#0d47a1',
          700: '#0a3a86',
          800: '#072d6b',
          900: '#041f4d',
        },
      },
      fontFamily: {
        heading: ['Cormorant Garamond', 'Georgia', 'serif'],
        body: ['Manrope', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
