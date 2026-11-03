# Instalar o kiosk num PC novo

O kiosk roda em Linux (Debian). Ele imprime pelo CUPS, que não existe no Windows.
No PC do kiosk não é preciso clonar o projeto nem instalar ferramentas de
desenvolvimento: basta o instalador pronto (`.deb`) e o script de instalação.

## O que levar (pendrive)

- `PrintFlow_0.1.0_amd64.deb`, gerado com `npm run tauri build` dentro de `kiosk/`
  (fica em `kiosk/src-tauri/target/release/bundle/deb/`)
- `instalar-kiosk.sh` (esta pasta)

## Passo a passo

1. Instale o **Debian 13** com a área de trabalho **GNOME** (padrão do instalador)
   e crie o usuário que vai rodar o kiosk (por exemplo, `kiosk`).
2. Ligue a impressora no USB e conecte o PC à internet.
3. Entre com esse usuário, abra o Terminal na pasta do pendrive e rode:

   ```bash
   sudo ./instalar-kiosk.sh PrintFlow_0.1.0_amd64.deb
   ```

   Para ver antes o que será feito, sem mudar nada:
   `./instalar-kiosk.sh --simular PrintFlow_0.1.0_amd64.deb`

4. Reinicie o PC (`sudo reboot`). O kiosk abre sozinho, em tela cheia.
5. Na Vercel (projeto `tcc-printflow` → Firewall), crie uma regra de exceção para
   o IP público da rede da escola. O script mostra esse IP no final.

## O que o script configura

| Passo | O quê |
|---|---|
| Pacotes | CUPS, `ipp-usb` (impressora USB sem driver) e o PrintFlow; o `.deb` instala o Node.js |
| Impressora | Fila `printflow` em `ipp://localhost:60000/ipp/print`, como padrão do sistema, com `printer-error-policy=retry-job` (se a impressora desligar, o trabalho espera e sai quando ela voltar) |
| Início automático | Login automático do usuário e abertura do PrintFlow ao entrar |
| Tela | Sem suspensão, sem bloqueio e sem apagar a tela |
| Fuso | `America/Sao_Paulo` |

O script pode ser rodado de novo sem problema. Se a impressora não estava ligada
durante a instalação, depois rode só esta parte:

```bash
sudo ./instalar-kiosk.sh --so-impressora
```

## Manutenção

- Sair do kiosk: **Alt+F4**. Abrir de novo: comando `printflow` ou pelo menu.
- Página de teste: `lp -d printflow /usr/share/cups/data/testprint`
- Atualizar o kiosk: copie o `.deb` novo e rode `sudo apt install --reinstall ./PrintFlow_0.1.0_amd64.deb`
- Configuração opcional (outro servidor, outra impressora):
  `~/.config/com.printflow.kiosk/.env`, por exemplo `CUPS_PRINTER=printflow`
- O login automático anterior fica salvo em `/etc/gdm3/daemon.conf.antes-printflow`.
