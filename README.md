# IG Mockup Composer

App local (servidor Node + página no navegador) que encaixa vídeos em massa
dentro do retângulo reservado de um mockup (fundo com logo + legenda),
gerando um `.mp4` final por vídeo de entrada.

## Requisitos

- Node.js instalado (`node --version`).
- `ffmpeg` instalado e disponível no PATH.
- Windows (os seletores de arquivo/pasta usam diálogos nativos via
  PowerShell + Windows Forms).

## Uso

1. Dê duplo clique em `iniciar.bat` — abre o navegador em
   `http://localhost:5177` e sobe o servidor local (a janela do terminal
   que abrir precisa ficar aberta enquanto usa a ferramenta).
2. **Imagem de fundo**: clique em "Escolher imagem..." e selecione o mockup.
3. **Retângulo**: arraste o retângulo azul em cima da prévia do mockup (ou
   edite os campos X/Y/Largura/Altura) até bater com o espaço reservado pro
   vídeo. Clique em "Gerar prévia com 1º vídeo" pra ver como fica com um
   vídeo de verdade encaixado (não só o retângulo).
4. **Pasta de vídeos**: escolha a pasta com os vídeos de entrada.
5. **Pasta de saída**: escolha onde salvar os vídeos finais.
6. Clique em **"Iniciar processamento"** — acompanha o progresso de cada
   vídeo em tempo real (pendente → processando → OK/falhou). Ao terminar,
   "Abrir pasta de saída" abre o resultado no Explorer.

## Como funciona

- `server.js`: servidor HTTP local (só `127.0.0.1`, sem dependências
  externas). Abre os diálogos nativos do Windows via um script PowerShell
  descartável (`System.Windows.Forms.OpenFileDialog` /
  `FolderBrowserDialog`), lista vídeos de uma pasta, serve a imagem de fundo
  pro navegador, gera prévias e roda o processamento em lote via
  `child_process.spawn("ffmpeg", ...)`, reportando progresso ao navegador
  por Server-Sent Events.
- `public/`: front-end (canvas com o retângulo arrastável/redimensionável
  pelos cantos, painéis de escolha de arquivo/pasta, lista de progresso).
- Para cada vídeo: `ffmpeg` redimensiona o vídeo pra caber inteiro dentro do
  retângulo (preservando proporção — sobra uma barra branca fina se a
  proporção não bater exatamente, sem cortar nada) e sobrepõe na posição
  escolhida em cima da imagem de fundo, mantendo o áudio original.

## Calibração padrão do retângulo

Os valores iniciais (x=180, y=430, largura=720, altura=1242) foram
calibrados comparando pixel a pixel um vídeo final já existente com o
mockup em branco. Servem de ponto de partida — ajuste arrastando o
retângulo na tela se usar um mockup diferente.

## Limitações

- Não adiciona cantos arredondados nem sombra — o vídeo entra reto no
  retângulo.
- Não gera texto dinâmico (contagem de views, legenda variável).
- Servidor local roda só em `127.0.0.1`; não é pra deixar exposto na rede.
