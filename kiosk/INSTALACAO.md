# Instalar o kiosk num PC novo

O kiosk roda em Linux (Debian). Ele imprime pelo CUPS, que não existe no Windows.
No PC do kiosk não é preciso clonar o projeto nem instalar ferramentas de
desenvolvimento: basta o instalador pronto (`.deb`) e os scripts desta pasta.

## O que levar (ou baixar da Release no GitHub)

- `PrintFlow_0.1.1_amd64.deb`, gerado com `npm run tauri build` dentro de `kiosk/`
  (fica em `kiosk/src-tauri/target/release/bundle/deb/`)
- `instalar-kiosk.sh`, `configurar-impressora.sh` e `travar-teclado.sh` (esta pasta)

Antes de rodar, dê permissão aos scripts: `chmod +x *.sh`

## 1. Instalar o app (não precisa da impressora)

1. Instale o **Debian 13** com a área de trabalho **GNOME** (padrão do instalador)
   e crie o usuário que vai rodar o kiosk (por exemplo, `kiosk`).
2. Conecte o PC à internet, entre com esse usuário, abra o Terminal na pasta dos
   arquivos e rode:

   ```bash
   sudo ./instalar-kiosk.sh PrintFlow_0.1.1_amd64.deb
   ```

3. Reinicie o PC (`sudo reboot`). O kiosk abre sozinho, em tela cheia. Sem a
   impressora ele funciona, mas não consegue imprimir.
4. Na Vercel (projeto `tcc-printflow` → Firewall), crie uma regra de exceção para
   o IP público da rede da escola. O script mostra esse IP no final.

## 2. Configurar a impressora (quando ela chegar)

Ligue a impressora no USB e rode:

```bash
sudo ./configurar-impressora.sh
```

O script encontra a impressora, cria a fila `printflow` e oferece imprimir uma
página de teste. Pode ser rodado de novo ao trocar de impressora.

## 3. Travar o teclado (quando tudo estiver testado)

```bash
sudo ./travar-teclado.sh          # aplica; reinicie o PC para valer
sudo ./travar-teclado.sh --liberar # desfaz
```

Desliga **todos** os atalhos do GNOME (tecla Super, Alt+Tab, Alt+F2, Ctrl+Alt+Del,
troca de terminal Ctrl+Alt+F1…F12, captura de tela etc.), deixando só:

| Atalho | Para quê |
|---|---|
| **Alt+F4** | fechar o kiosk na manutenção |
| **Ctrl+Alt+Shift+T** | abrir o terminal de manutenção (com o kiosk fechado) |
| Volume e microfone | não abrem nada |

Também desliga os cantos ativos da tela, sair da sessão, trocar de usuário, as
janelas de impressão do sistema (ninguém imprime por fora do kiosk; o kiosk
imprime direto pelo CUPS), a abertura automática de pendrive e o botão
liga/desliga. Os atalhos ficam trancados: não dá para religá-los pelas
Configurações.

Dentro da tela do kiosk, o próprio app (a partir da versão 0.1.1) bloqueia
Ctrl+P, Ctrl+S, Ctrl+R, F1–F12, zoom, "voltar" e o clique direito. Digitar,
copiar e colar continuam funcionando.

## O que o instalador configura

| Passo | O quê |
|---|---|
| Pacotes | PrintFlow, CUPS e `ipp-usb` (impressora USB sem driver); o `.deb` instala o Node.js |
| Início automático | Login automático do usuário e abertura do PrintFlow ao entrar |
| Tela | Sem suspensão, sem bloqueio e sem apagar a tela |
| Fuso | `America/Sao_Paulo` |

A fila da impressora usa `printer-error-policy=retry-job`: se a impressora
desligar ou ficar sem papel, o trabalho espera e sai quando ela voltar.

Todos os scripts aceitam `--simular`, que mostra o que seria feito sem mudar nada,
e podem ser rodados mais de uma vez.

## Manutenção

- Sair do kiosk: **Alt+F4**. Abrir de novo: comando `printflow`.
- Com o teclado travado, o terminal abre com **Ctrl+Alt+Shift+T** (feche o kiosk antes).
- Página de teste: `lp -d printflow /usr/share/cups/data/testprint`
- Atualizar o kiosk: `sudo apt install ./PrintFlow_<versão>_amd64.deb`
- Configuração opcional (outro servidor, outra impressora):
  `~/.config/com.printflow.kiosk/.env`, por exemplo `CUPS_PRINTER=printflow`
- O login automático anterior fica salvo em `/etc/gdm3/daemon.conf.antes-printflow`.
