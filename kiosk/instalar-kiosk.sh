#!/usr/bin/env bash
# Instala e configura o kiosk do PrintFlow num PC com Debian (feito para Debian 13 + GNOME).
#
# O que faz:
#   1. instala o CUPS e o ipp-usb (impressora USB sem driver) e o app do kiosk (.deb);
#   2. cria a fila de impressão "printflow" apontando para a impressora USB;
#   3. abre o kiosk sozinho ao ligar o PC (login automático + início automático);
#   4. impede suspensão, bloqueio e apagamento da tela;
#   5. acerta o fuso horário para America/Sao_Paulo.
#
# Uso (no PC do kiosk, logado com o usuário que vai rodar o kiosk):
#   sudo ./instalar-kiosk.sh PrintFlow_0.1.0_amd64.deb   instalação completa
#   sudo ./instalar-kiosk.sh --so-impressora             refaz só a fila da impressora
#   ./instalar-kiosk.sh --simular PrintFlow_0.1.0_amd64.deb
#                                                       mostra o que faria, sem mudar nada
#
# Pode ser rodado mais de uma vez: cada passo confere o que já existe.
set -euo pipefail

FILA="printflow"
URI_IMPRESSORA="ipp://localhost:60000/ipp/print"   # endereço que o ipp-usb dá à 1ª impressora USB
FUSO="America/Sao_Paulo"

SIMULAR=0
SO_IMPRESSORA=0
DEB=""
for arg in "$@"; do
  case "$arg" in
    --simular) SIMULAR=1 ;;
    --so-impressora) SO_IMPRESSORA=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) DEB="$arg" ;;
  esac
done

# ── Saída ────────────────────────────────────────────────────────────
if [ -t 1 ]; then V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; N=$'\e[1m'; Z=$'\e[0m'; else V=; A=; R=; N=; Z=; fi
etapa() { printf '\n%s==> %s%s\n' "$N" "$1" "$Z"; }
ok()    { printf '%s  ✓ %s%s\n' "$V" "$1" "$Z"; }
aviso() { printf '%s  ! %s%s\n' "$A" "$1" "$Z"; }
erro()  { printf '%s  ✗ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }

# Executa um comando, ou só mostra no modo --simular
roda() {
  if [ "$SIMULAR" = 1 ]; then printf '    [simular] %s\n' "$*"; else "$@"; fi
}

# Grava um arquivo (conteúdo na entrada padrão), ou só mostra no modo --simular
grava() {
  local destino="$1" conteudo
  conteudo="$(cat)"
  if [ "$SIMULAR" = 1 ]; then
    printf '    [simular] gravaria %s:\n' "$destino"
    printf '%s\n' "$conteudo" | sed 's/^/      | /'
  else
    mkdir -p "$(dirname "$destino")"
    printf '%s\n' "$conteudo" > "$destino"
  fi
}

# ── Verificações ─────────────────────────────────────────────────────
etapa "Verificando o sistema"
. /etc/os-release
[ "${ID:-}" = debian ] || [[ " ${ID_LIKE:-} " == *" debian "* ]] || erro "Este script é para Debian (encontrado: ${PRETTY_NAME:-desconhecido})."
[ "$(dpkg --print-architecture)" = amd64 ] || erro "O instalador do kiosk é para PCs de 64 bits (amd64)."
ok "$PRETTY_NAME, amd64"

if [ "$SIMULAR" = 0 ] && [ "$(id -u)" != 0 ]; then
  erro "Rode com sudo: sudo $0 $*"
fi

# Usuário que vai usar o kiosk: quem chamou o sudo
USUARIO="${SUDO_USER:-$(id -un)}"
if [ "$USUARIO" = root ]; then
  erro "Entre no PC com o usuário do kiosk (não root) e rode com sudo."
fi
CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
ok "usuário do kiosk: $USUARIO ($CASA)"

if [ "$SO_IMPRESSORA" = 0 ]; then
  [ -n "$DEB" ] || erro "Informe o instalador: sudo $0 PrintFlow_0.1.0_amd64.deb"
  [ -f "$DEB" ] || erro "Arquivo não encontrado: $DEB"
  DEB="$(realpath "$DEB")"
  ok "instalador: $DEB"
fi

# ── 1. Pacotes ───────────────────────────────────────────────────────
if [ "$SO_IMPRESSORA" = 0 ]; then
  etapa "1/5 Instalando CUPS, ipp-usb e o PrintFlow"
  roda apt-get update -qq
  roda env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cups cups-ipp-utils ipp-usb dconf-cli curl
  # O .deb puxa as próprias dependências (Node.js e o motor web do app)
  roda env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$DEB"
  roda systemctl enable --now cups
  # O usuário do kiosk pode gerenciar a impressora (ex.: retomar a fila)
  roda usermod -aG lpadmin "$USUARIO"
  ok "pacotes instalados"
fi

# ── 2. Impressora ────────────────────────────────────────────────────
etapa "2/5 Configurando a impressora (fila \"$FILA\")"
impressora_responde() {
  ipptool -q -T 5 "$URI_IMPRESSORA" get-printer-attributes.test >/dev/null 2>&1
}
if [ "$SIMULAR" = 1 ]; then
  printf '    [simular] esperaria a impressora USB responder em %s\n' "$URI_IMPRESSORA"
  encontrada=1
else
  systemctl restart ipp-usb 2>/dev/null || true
  encontrada=0
  for _ in $(seq 1 30); do
    if impressora_responde; then encontrada=1; break; fi
    sleep 2
  done
fi
if [ "$encontrada" = 1 ]; then
  # retry-job: se a impressora desligar, o trabalho espera e sai quando ela voltar
  # (o padrão do CUPS pausa a fila e o kiosk ficaria travado até alguém liberar)
  roda lpadmin -p "$FILA" -E -v "$URI_IMPRESSORA" -m everywhere \
    -D "PrintFlow (kiosk)" -o printer-error-policy=retry-job
  roda lpadmin -d "$FILA"
  roda cupsenable "$FILA"
  roda cupsaccept "$FILA"
  ok "fila \"$FILA\" criada para $URI_IMPRESSORA"
else
  aviso "Nenhuma impressora USB respondeu em 60 s."
  aviso "Ligue a impressora no USB e depois rode: sudo $0 --so-impressora"
fi

if [ "$SO_IMPRESSORA" = 1 ]; then
  [ "$encontrada" = 1 ] || exit 1
  printf '\nImpressora configurada. Para testar: lp -d %s /usr/share/cups/data/testprint\n' "$FILA"
  exit 0
fi

# ── 3. Início automático ─────────────────────────────────────────────
etapa "3/5 Abrindo o kiosk sozinho ao ligar o PC"
grava "$CASA/.config/autostart/printflow-kiosk.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=PrintFlow Kiosk
Comment=Abre o kiosk do PrintFlow ao entrar
Exec=/usr/bin/printflow
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
DESKTOP
roda chown -R "$USUARIO:$USUARIO" "$CASA/.config/autostart"

if [ -f /etc/gdm3/daemon.conf ]; then
  if [ "$SIMULAR" = 1 ]; then
    printf '    [simular] ativaria em /etc/gdm3/daemon.conf: AutomaticLoginEnable=true, AutomaticLogin=%s\n' "$USUARIO"
  else
    [ -f /etc/gdm3/daemon.conf.antes-printflow ] || cp /etc/gdm3/daemon.conf /etc/gdm3/daemon.conf.antes-printflow
    # Remove linhas antigas (comentadas ou não) e grava as novas logo após [daemon]
    sed -i -E '/^[#[:space:]]*AutomaticLogin(Enable)?[[:space:]]*=/d' /etc/gdm3/daemon.conf
    sed -i "/^\[daemon\]/a AutomaticLoginEnable = true\nAutomaticLogin = $USUARIO" /etc/gdm3/daemon.conf
  fi
  ok "login automático (GDM) para $USUARIO"
elif [ -d /etc/lightdm ]; then
  grava /etc/lightdm/lightdm.conf.d/50-printflow.conf <<LIGHTDM
[Seat:*]
autologin-user=$USUARIO
autologin-user-timeout=0
LIGHTDM
  ok "login automático (LightDM) para $USUARIO"
else
  aviso "Gerenciador de login não reconhecido: configure o login automático manualmente."
fi

# ── 4. Tela sempre ligada ────────────────────────────────────────────
etapa "4/5 Desligando suspensão, bloqueio e apagamento da tela"
roda systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# Padrões do GNOME para todos os usuários deste PC
if [ ! -f /etc/dconf/profile/user ] || ! grep -q '^system-db:local' /etc/dconf/profile/user; then
  grava /etc/dconf/profile/user <<'PERFIL'
user-db:user
system-db:local
PERFIL
fi
grava /etc/dconf/db/local.d/00-printflow-kiosk <<'DCONF'
[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false

[org/gnome/desktop/lockdown]
disable-lock-screen=true

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'
idle-dim=false

[org/gnome/desktop/notifications]
show-banners=false
DCONF
roda dconf update
ok "tela sempre ligada, sem bloqueio"

# ── 5. Fuso horário ──────────────────────────────────────────────────
etapa "5/5 Fuso horário"
roda timedatectl set-timezone "$FUSO"
ok "$FUSO"

# ── Resumo ───────────────────────────────────────────────────────────
etapa "Pronto"
IP_PUBLICO="$(curl -s --max-time 5 https://api.ipify.org || true)"
cat <<FIM
  O PrintFlow foi instalado e vai abrir sozinho, em tela cheia, ao ligar o PC.

  Falta:
  1. Reiniciar o PC:  sudo reboot
  2. Na Vercel, criar uma regra de exceção no Firewall para o IP desta rede
     ${IP_PUBLICO:+(IP público agora: $IP_PUBLICO)}, para o kiosk nunca ser bloqueado.
  3. Testar a impressora:  lp -d $FILA /usr/share/cups/data/testprint

  Para sair do kiosk (manutenção): Alt+F4. Para abrir de novo: comando "printflow".
  Configuração opcional do kiosk: $CASA/.config/com.printflow.kiosk/.env
FIM
[ "$encontrada" = 1 ] || aviso "A impressora ainda não foi configurada (veja o aviso no passo 2)."
