#!/usr/bin/env bash
# Desliga os atalhos de teclado do GNOME no PC do kiosk, para ninguém sair do PrintFlow
# nem abrir outros programas. Feito para Debian 13 + GNOME 48.
#
# Desliga TODOS os atalhos do sistema (lidos do próprio PC), exceto:
#   - Alt+F4 (fechar janela): ainda usado para sair do kiosk na manutenção;
#   - teclas de volume e microfone.
# Cria um atalho de manutenção: Ctrl+Alt+Shift+T abre o terminal.
# Também desliga: tecla Super, cantos ativos, Alt+F2, sair da sessão, trocar de
# usuário, janelas de impressão do sistema (o kiosk imprime direto pelo CUPS),
# abertura automática de pendrive e o botão liga/desliga.
# Os atalhos ficam trancados: não dá para religá-los pelas Configurações.
#
# Uso:
#   sudo ./travar-teclado.sh             aplica (vale a partir do próximo login: reinicie o PC)
#   sudo ./travar-teclado.sh --liberar   desfaz tudo
#   ./travar-teclado.sh --simular        mostra o que faria, sem mudar nada
set -euo pipefail

ARQUIVO=/etc/dconf/db/local.d/10-printflow-teclado
TRAVAS=/etc/dconf/db/local.d/locks/10-printflow-teclado
ATALHO_MANUTENCAO='<Control><Alt><Shift>t'
CAMINHO_MANUTENCAO=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/printflow-manutencao/
# Seção do arquivo do dconf: sem a barra inicial nem a final
SECAO_MANUTENCAO=org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/printflow-manutencao

SIMULAR=0
LIBERAR=0
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    --liberar) LIBERAR=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) printf 'Opção desconhecida: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

# ── Saída ────────────────────────────────────────────────────────────
if [ -t 1 ]; then V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; N=$'\e[1m'; Z=$'\e[0m'; else V=; A=; R=; N=; Z=; fi
etapa() { printf '\n%s==> %s%s\n' "$N" "$1" "$Z"; }
ok()    { printf '%s  ✓ %s%s\n' "$V" "$1" "$Z"; }
erro()  { printf '%s  ✗ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }
roda()  { if [ "$SIMULAR" = 1 ]; then printf '    [simular] %s\n' "$*"; else "$@"; fi; }

if [ "$SIMULAR" = 0 ] && [ "$(id -u)" != 0 ]; then
  erro "Rode com sudo: sudo $0 $*"
fi
command -v gsettings >/dev/null || erro "gsettings não encontrado (este script é para o GNOME)."
command -v dconf >/dev/null || erro "dconf não encontrado. Rode antes o instalar-kiosk.sh."

# ── Liberar ──────────────────────────────────────────────────────────
if [ "$LIBERAR" = 1 ]; then
  etapa "Religando os atalhos de teclado"
  roda rm -f "$ARQUIVO" "$TRAVAS"
  roda dconf update
  ok "atalhos de volta ao normal (vale a partir do próximo login: reinicie o PC)"
  exit 0
fi

# ── Monta a configuração ─────────────────────────────────────────────
etapa "Lendo os atalhos existentes neste PC"
GRUPOS=(
  org.gnome.desktop.wm.keybindings
  org.gnome.shell.keybindings
  org.gnome.mutter.keybindings
  org.gnome.mutter.wayland.keybindings
  org.gnome.settings-daemon.plugins.media-keys
)
# Atalhos que continuam funcionando
manter() {
  case "$1/$2" in
    org.gnome.desktop.wm.keybindings/close) return 0 ;;                          # Alt+F4
    org.gnome.settings-daemon.plugins.media-keys/volume-*) return 0 ;;
    org.gnome.settings-daemon.plugins.media-keys/mic-mute*) return 0 ;;
    org.gnome.settings-daemon.plugins.media-keys/custom-keybindings) return 0 ;;  # tratado abaixo
  esac
  return 1
}

conteudo=""
travas=""
desligados=0
for grupo in "${GRUPOS[@]}"; do
  gsettings list-schemas | grep -qx "$grupo" || continue
  caminho="/${grupo//.//}"
  conteudo+="[${caminho#/}]"$'\n'
  while read -r chave; do
    # Só listas de teclas ("as"); valores numéricos como volume-step ficam como estão
    [ "$(gsettings range "$grupo" "$chave" | head -1)" = "type as" ] || continue
    manter "$grupo" "$chave" && continue
    conteudo+="$chave=@as []"$'\n'
    travas+="$caminho/$chave"$'\n'
    desligados=$((desligados + 1))
  done < <(gsettings list-keys "$grupo" | sort)
  conteudo+=$'\n'
done
ok "$desligados atalhos serão desligados (mantidos: Alt+F4, volume e microfone)"

# Atalho de manutenção e demais travas
conteudo+="[org/gnome/settings-daemon/plugins/media-keys]
custom-keybindings=['$CAMINHO_MANUTENCAO']

[${SECAO_MANUTENCAO}]
name='Terminal de manutenção (PrintFlow)'
command='x-terminal-emulator'
binding='$ATALHO_MANUTENCAO'

[org/gnome/mutter]
overlay-key=''

[org/gnome/desktop/interface]
enable-hot-corners=false

[org/gnome/desktop/lockdown]
disable-command-line=true
disable-log-out=true
disable-user-switching=true
disable-printing=true
disable-print-setup=true
disable-application-handlers=true

[org/gnome/desktop/media-handling]
automount-open=false
autorun-never=true

[org/gnome/settings-daemon/plugins/power]
power-button-action='nothing'
"
travas+="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings
/org/gnome/mutter/overlay-key
/org/gnome/desktop/interface/enable-hot-corners
/org/gnome/desktop/lockdown/disable-command-line
/org/gnome/desktop/lockdown/disable-log-out
/org/gnome/desktop/lockdown/disable-user-switching
/org/gnome/desktop/lockdown/disable-printing
/org/gnome/desktop/lockdown/disable-print-setup
/org/gnome/desktop/lockdown/disable-application-handlers
/org/gnome/desktop/media-handling/automount-open
/org/gnome/desktop/media-handling/autorun-never
/org/gnome/settings-daemon/plugins/power/power-button-action
"

# ── Grava ────────────────────────────────────────────────────────────
etapa "Aplicando"
if [ "$SIMULAR" = 1 ]; then
  previa="$(mktemp -d)"
  mkdir -p "$previa/locks"
  printf '%s' "$conteudo" > "$previa/10-printflow-teclado"
  printf '%s' "$travas" > "$previa/locks/10-printflow-teclado"
  printf '    [simular] gravaria %s e %s\n' "$ARQUIVO" "$TRAVAS"
  printf '    [simular] prévia desses arquivos em: %s\n' "$previa"
  printf '    [simular] dconf update\n'
else
  # O perfil que faz o GNOME ler as configurações do sistema (o instalador já cria)
  if [ ! -f /etc/dconf/profile/user ] || ! grep -q '^system-db:local' /etc/dconf/profile/user; then
    printf 'user-db:user\nsystem-db:local\n' > /etc/dconf/profile/user
  fi
  mkdir -p "$(dirname "$TRAVAS")"
  printf '%s' "$conteudo" > "$ARQUIVO"
  printf '%s' "$travas" > "$TRAVAS"
  dconf update
fi
ok "configuração gravada"

etapa "Pronto"
cat <<FIM
  Reinicie o PC (sudo reboot) para valer em todo o sistema.

  Continuam funcionando:
    Alt+F4             fecha o kiosk (manutenção)
    Ctrl+Alt+Shift+T   abre o terminal de manutenção (depois de fechar o kiosk)

  Para desfazer:  sudo ./travar-teclado.sh --liberar
FIM
