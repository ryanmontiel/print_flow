#!/usr/bin/env bash
# Configura a impressora do kiosk do PrintFlow (rode depois do instalar-kiosk.sh).
#
# Cria a fila "printflow" para a impressora ligada no USB (sem driver, via ipp-usb),
# como padrão do sistema, e com a política "retry-job": se a impressora desligar ou
# ficar sem papel, o trabalho espera e sai quando ela voltar (o padrão do CUPS pausa
# a fila e o kiosk ficaria travado até alguém liberar).
#
# Uso (com a impressora ligada no USB):
#   sudo ./configurar-impressora.sh
#   ./configurar-impressora.sh --simular   mostra o que faria, sem mudar nada
#
# Pode ser rodado de novo, por exemplo ao trocar a impressora.
set -euo pipefail

FILA="printflow"
URI_IMPRESSORA="ipp://localhost:60000/ipp/print"   # endereço que o ipp-usb dá à 1ª impressora USB

SIMULAR=0
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) printf 'Opção desconhecida: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

# ── Saída ────────────────────────────────────────────────────────────
if [ -t 1 ]; then V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; N=$'\e[1m'; Z=$'\e[0m'; else V=; A=; R=; N=; Z=; fi
etapa() { printf '\n%s==> %s%s\n' "$N" "$1" "$Z"; }
ok()    { printf '%s  ✓ %s%s\n' "$V" "$1" "$Z"; }
aviso() { printf '%s  ! %s%s\n' "$A" "$1" "$Z"; }
erro()  { printf '%s  ✗ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }
roda()  { if [ "$SIMULAR" = 1 ]; then printf '    [simular] %s\n' "$*"; else "$@"; fi; }

# ── Verificações ─────────────────────────────────────────────────────
etapa "Verificando"
if [ "$SIMULAR" = 0 ] && [ "$(id -u)" != 0 ]; then
  erro "Rode com sudo: sudo $0"
fi
for cmd in lpadmin ipptool; do
  command -v "$cmd" >/dev/null || [ -x "/usr/sbin/$cmd" ] || erro "\"$cmd\" não encontrado. Rode antes: sudo ./instalar-kiosk.sh PrintFlow_*.deb"
done
ok "CUPS instalado"

# ── Impressora ───────────────────────────────────────────────────────
etapa "Procurando a impressora no USB"
impressora_responde() {
  ipptool -q -T 5 "$URI_IMPRESSORA" get-printer-attributes.test >/dev/null 2>&1
}
if [ "$SIMULAR" = 1 ]; then
  printf '    [simular] esperaria a impressora responder em %s (até 60 s)\n' "$URI_IMPRESSORA"
else
  systemctl restart ipp-usb 2>/dev/null || true
  encontrada=0
  for _ in $(seq 1 30); do
    if impressora_responde; then encontrada=1; break; fi
    sleep 2
  done
  if [ "$encontrada" = 0 ]; then
    aviso "Nenhuma impressora respondeu em 60 s."
    aviso "Confira se ela está ligada e com o cabo USB conectado neste PC, e rode de novo."
    exit 1
  fi
  modelo="$(ipptool -tv "$URI_IMPRESSORA" get-printer-attributes.test 2>/dev/null | sed -n 's/.*printer-make-and-model (textWithoutLanguage) = //p' | head -1)"
  ok "encontrada: ${modelo:-impressora IPP}"
fi

etapa "Criando a fila \"$FILA\""
roda lpadmin -p "$FILA" -E -v "$URI_IMPRESSORA" -m everywhere \
  -D "PrintFlow (kiosk)" -o printer-error-policy=retry-job
roda lpadmin -d "$FILA"
roda cupsenable "$FILA"
roda cupsaccept "$FILA"
ok "fila \"$FILA\" pronta e definida como padrão"

# ── Página de teste ──────────────────────────────────────────────────
if [ "$SIMULAR" = 0 ] && [ -t 0 ]; then
  printf '\nImprimir uma página de teste agora? [s/N] '
  read -r resposta
  if [[ "$resposta" =~ ^[sS] ]]; then
    lp -d "$FILA" /usr/share/cups/data/testprint && ok "página de teste enviada"
  fi
fi

etapa "Pronto"
printf '  O kiosk já pode imprimir. Página de teste a qualquer momento:\n'
printf '  lp -d %s /usr/share/cups/data/testprint\n' "$FILA"
