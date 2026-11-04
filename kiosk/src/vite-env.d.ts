/// <reference types="vite/client" />
// Tipos do Vite para o TypeScript, incluindo imports com sufixo ?url (devolvem a URL do arquivo)

declare module '*?url' {
  const url: string
  export default url
}