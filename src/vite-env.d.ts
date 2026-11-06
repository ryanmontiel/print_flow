// Imports com sufixo ?url (o Vite devolve o endereço do arquivo, ex.: o worker do pdf.js)
declare module '*?url' {
  const url: string
  export default url
}
