// Permite importar arquivos .css no TypeScript sem erro de tipo
declare module '*.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
