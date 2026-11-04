// Bloqueia, dentro da tela do kiosk, atalhos e gestos que poderiam abrir algo fora do
// fluxo do PrintFlow (imprimir pelo sistema, recarregar, zoom, ferramentas, menus).
// Os atalhos do sistema (Super, Alt+Tab etc.) são desligados pelo travar-teclado.sh;
// o Alt+F4 é tratado pelo sistema antes de chegar aqui e continua funcionando.

// Ctrl/Cmd + tecla: imprimir, salvar, abrir, recarregar, buscar, código-fonte,
// downloads, histórico, endereço, nova janela/aba, fechar aba e zoom.
// Copiar, colar, recortar, desfazer e selecionar tudo continuam liberados.
const COM_CTRL = new Set(['p', 's', 'o', 'r', 'f', 'g', 'u', 'j', 'h', 'l', 'n', 't', 'w', 'd', 'e', 'k', '+', '=', '-', '_', '0'])

// Diz se a combinação de teclas deve ser ignorada (exportada para os testes)
export function deveBloquear(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
  const tecla = e.key.toLowerCase()
  if (/^f([1-9]|1[0-2])$/.test(tecla)) return true                       // F1–F12 (F5, F11, F12...)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c', 'k', 'r', 'delete'].includes(tecla)) return true
  if ((e.ctrlKey || e.metaKey) && COM_CTRL.has(tecla)) return true
  if (e.altKey && ['arrowleft', 'arrowright', 'home'].includes(tecla)) return true  // voltar/avançar/início
  if (['browserback', 'browserforward', 'browserrefresh', 'browserhome', 'browsersearch', 'contextmenu', 'print'].includes(tecla)) return true
  return false
}

// Registra os bloqueios na fase de captura, antes de qualquer outro tratador da página
export function ativarBloqueioTeclado() {
  const bloquear = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  window.addEventListener('keydown', (e) => { if (deveBloquear(e)) bloquear(e) }, { capture: true })
  window.addEventListener('contextmenu', bloquear, { capture: true })                 // clique direito
  window.addEventListener('dragstart', bloquear, { capture: true })                   // arrastar links/imagens
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) bloquear(e) }, { capture: true, passive: false })  // zoom
  window.print = () => {}
}
