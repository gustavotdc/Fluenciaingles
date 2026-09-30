# Fluência — arquitetura do sistema

Documento de referência. Toda sessão futura que for mexer no sistema de inglês
do Gustavo deve ler isto antes.

Atualizado em 30/09/2026 (versão 20 do sistema — push imediato ao marcar
leitura como concluída, corrige texto "lido" que não sincronizava; sistema
migrado também pro GitHub Pages, com banco Supabase próprio — ver seção
"Segunda plataforma").

---

## Onde as coisas vivem

| O quê | Onde | Observação |
|---|---|---|
| O sistema (app) | Artifact `https://claude.ai/artifact/FJ4Vfyy5v1Vsh1t1PRbMsH` | Link fixo. Republicar **sempre nessa URL**, nunca criar outro. |
| Progresso do Gustavo | Banco do artifact: coleção `estado`, documento `principal` | Lido/escrito com a ferramenta `ArtifactData`. Sincroniza PC ↔ celular sozinho. |
| Imagens dos PAV | Armazenamento de assets do artifact | O estado guarda só o id; a imagem serve em `/_blob/<id>`. |
| Backups | `C:\Users\rober\OneDrive\Documentos\Inglês fluente\Backups\` | Um JSON por dia, gerado por tarefa agendada. |
| Cópia offline | `...\Inglês fluente\Ingles-Fluencia.html` | Sem progresso, sem imagens. Leitura e Escrita funcionam mesmo assim (bancos prontos, zero IA); Antecipar também, enquanto o banco de 150 não acabar. Só emergência mesmo assim. |
| Fonte do build | `/tmp/app_template.html` + `/tmp/build.py` (container) | **Efêmero.** Ver "Reconstruir do zero". |
| Planilha das 3000 palavras | `/mnt/user-data/outputs/05-level1-1200-palavras.xlsx`, aba `Level 1` | Nome do arquivo ficou legado (era 1200), conteúdo já é 3000. Fonte única — o `build.py` lê o PAV direto da coluna dela. |
| Banco pronto de Leitura | `/tmp/txt_banco.json` → `/mnt/user-data/outputs/expansao-3000/` | 60 textos prontos (título, cena, linhas en/fon/pt). Ver seção própria. |
| Banco pronto de Antecipar | `/tmp/ant_banco.json` → `/mnt/user-data/outputs/expansao-3000/` | 150 itens prontos (ctx/en/alvo/pt). Ver seção própria. |

Capacidades declaradas no artifact: `db`, `assets`, `sample`, `downloads`.
Republicar sem passar `capabilities` mantém todas.

---

## A regra que não pode ser quebrada

**O progresso é guardado pelo TEXTO do item, não pela posição na lista.**

No documento salvo (formato `f:4`):

- `w` — chave é a palavra em inglês minúscula (`"head"`), valor
  `[estágio, próxima/1000, aprendida/1000, erros, tentativas, dominada, reforço]`
- `r` — chave é a **forma reduzida** da redução (`"i'm gonna call you."`)
- `c` — chave é o bloco em inglês (`"how's it going?"`) — inclui os 157 verbos
  frasais, que vivem no mesmo array `C`, tag `grupo:"Verbos frasais"`
- `pav`, `img` — chave é a palavra em inglês
- `dias` — chave `AAAA-MM-DD`, valor
  `[novas, revs, dom, li, sp, gr, limpo, red, chk, txt, rel, ant, wr]`
  (índice 12, `wr` — marca se a escrita curta do dia foi feita)
- `txt` — lista dos textos de leitura mais recentes (máx. 12)
- `rel` — relâmpago: `{seq, acertos, tempo, rodadas, recentes}`;
  `recentes` também vai por texto (`packRel`/`unpackRel`)
- `ant` — antecipar: `{feitas, cheios, rodadas}` — só números e histórico,
  nenhuma chave presa a palavra (`packAnt`/`unpackAnt`)
- `cv` — assinatura do conteúdo (`"3000/67/413"`), só para diagnóstico

Dentro do programa tudo continua indexado por posição; a conversão acontece
em `pack()` e `unpack()`. `unpack()` conta em `orfas` as chaves que não existem
mais na lista atual, e a aba Dados mostra isso como "Registros perdidos".

**Formatos anteriores** (`f:2`, `f:3`, e o estado cru sem `f`) ainda são lidos:
naqueles as chaves eram posições. `unpack()` detecta e converte. Não remover
esse caminho.

Campos novos em `dias` entram **no fim do array** — índice a mais é lido como
zero num estado antigo, então nada quebra.

---

## Confirmação: `confirmar()`, não `confirm()` nativo

**Bug encontrado e corrigido em 25/09.** O Artifact publicado roda dentro de
um iframe `sandboxed` (segurança do lado do claude.ai) sem o atributo
`allow-modals`. Isso faz `window.confirm()`, `alert()` e `prompt()` nativos
serem **silenciosamente ignorados** — sem erro, sem aviso, só retornam
`false`/`undefined` na hora. Todo `if(!confirm(...)) return;` saía fora sem
fazer nada, e o usuário só via "cliquei e não aconteceu nada". Comprovado com
teste isolado num iframe sandboxed (ver `/tmp/test_sandbox_confirm.js` — não
copiado pra `expansao-3000`, é só um teste de diagnóstico, reproduzível se
precisar de novo).

Isso derrubava **9 pontos** do sistema, sempre do mesmo jeito silencioso:
zerar progresso, sair de sessão/revisão/treino (5 telas), remover imagem de
PAV (2 lugares), importar arquivo por cima do progresso atual. Foi assim
desde sempre — não quebrou nesta sessão, só nunca tinha sido percebido
(reportado por ele: "cliquei lá no botão de zerar tudo e não zerou nada").

**Correção:** função própria `confirmar(msg, msg2)` — um modal no mesmo
padrão visual do resto do app (`.modal`/`.card`, botões Cancelar/Confirmar),
retorna uma `Promise<boolean>`. Os 9 call sites viraram `async () => { if(await
confirmar(...)) ... }`. **Qualquer novo "tem certeza?" no sistema tem que usar
`confirmar()`, nunca `confirm()` nativo** — não funciona no Artifact publicado,
só na cópia offline (fora de iframe).

---

## Sincronização: push imediato ao marcar leitura como concluída (v20)

**Bug encontrado e corrigido em 26/09.** Ele reportou: gerou um segundo texto
de Leitura no dia, leu, concluiu ("Terminei") — e mesmo assim não ficou
marcado como lido. Conferido no banco real dele via `ArtifactData`: o texto
mais novo do dia estava salvo com `lido:0` e `dias[hoje].txt = 1` (só o
primeiro texto contou).

`save()` grava local na hora, mas o envio pro banco remoto (`pushRemote()`)
é **debounced em 1200ms** (`schedulePush()`) e só é forçado na hora
(`flushPush()`) por `visibilitychange`/`pagehide`/`blur`. Não consegui
reproduzir o bug simulando a sequência exata (gerar → ler → concluir → gerar
→ ler → concluir) — o caminho mais provável é o push do "Terminei" não ter
saído a tempo antes de ele sair da tela/trocar de aba, e por algum motivo os
eventos de flush não pegaram essa saída específica a tempo.

**Correção (mínima, só neste ponto):** o clique em "Terminei"
(`LeituraSession`, botão `#fim`) agora chama `flushPush()` logo depois de
`save()`, em vez de esperar o debounce de 1200ms. Isso não muda nenhuma outra
lógica de sincronização — só garante que o "lido" do texto saia pro banco
remoto imediatamente, sem depender de ele sair da tela a tempo.

Testes (`test_v13.js`, `test_extra.js`) continuam passando (36 + 11 = 47
verificações destes dois arquivos). Se o problema voltar a acontecer, meu
teste local não reproduziu a causa raiz com certeza — só o efeito, confirmado
no banco real dele.

---

## Segunda plataforma: GitHub Pages + Supabase (30/09)

Motivo: reduzir a dependência do Artifact do Claude (sandbox efêmero, sessão
se reconstrói do zero a cada vez) e ter o código num repositório versionado
de verdade, com testes obrigatórios antes de publicar.

- **Repositório:** `https://github.com/gustavotdc/Fluenciaingles` (público —
  necessário pro GitHub Pages funcionar no plano grátis).
- **Publicação automática:** `.github/workflows/deploy.yml` roda
  `python3 src/build.py` e publica `dist/index.html` no GitHub Pages a cada
  push em `main`. Não precisa mexer em nada manual depois de um push — só
  editar os arquivos fonte (`src/app_template.html`, `data/...`) e commitar.
- **Site ao vivo:** `https://gustavotdc.github.io/Fluenciaingles/`.
- **Banco de dados:** Supabase, projeto `gustavotdc's Project`
  (`iopcocewxebrsiyqqezx`), tabela `estado` (`id text primary key, dados
  jsonb, atualizado_em timestamptz`), uma linha só (`id = 'principal'`), RLS
  liberado pra leitura/escrita pela chave publishable (é assim que o
  Supabase espera que se use essa chave — o controle de acesso é por
  política de RLS na tabela, não por esconder a chave, que fica visível no
  código do navegador de qualquer jeito).
- **Como sincroniza:** `src/app_template.html` ganhou um caminho novo em
  `initSync()` — quando `window.claude` não existe (ou seja, fora do
  Artifact), usa `supaRef()` (função nova) que fala com o Supabase pela API
  REST (PostgREST), com a mesma forma (`get`/`set`) que o `dbRef` do Artifact
  já usava, então todo o resto do código de sync (`pushRemote`, `schedulePush`,
  `flushPush`, `adota`) não mudou nada. Como a API REST simples não tem
  tempo real, a página busca de novo sempre que volta a ficar visível
  (equivalente ao que o `onSnapshot` fazia no Artifact).
- **Importante:** essa é uma base de dados **separada** da do Artifact —
  progresso feito numa plataforma não aparece na outra. Ele decidiu focar no
  GitHub Pages pra usar no celular e no computador com o mesmo progresso.
- Chave publishable e URL do projeto ficam como constantes no topo do
  `app_template.html` (`SUPA_URL`, `SUPA_KEY`, `SUPA_ROW`).

---

## Como acrescentar palavras, reduções ou blocos

1. Gerar backup antes (ou confirmar que a tarefa diária rodou).
2. Acrescentar **no fim** do arquivo de origem. Nunca no meio, nunca reordenar,
   nunca reaproveitar um texto que já existe (a chave é o texto — texto repetido
   funde dois históricos).
   - Palavras: `/mnt/user-data/outputs/05-level1-1200-palavras.xlsx`, aba `Level 1`
     (a coluna PAV já traz o texto certo — não precisa de arquivo `.txt` solto)
   - Reduções: `/tmp/reducoes.txt` — `completa|reduzida|comoFala|pt|regra`
   - Blocos (inclui verbos frasais): `/tmp/chunks.txt` — `en|comoFala|pt|grupo`
   - Famílias: gerar de novo com `/tmp/gerar_familias.py`
3. Rodar `/tmp/build.py`.
4. Rodar as suítes de teste (ver abaixo).
5. Republicar na mesma URL.
6. Conferir "Registros perdidos" na aba Dados: tem que continuar em nenhum.

Palavras novas entram em dias novos no fim do cronograma. Isso é o esperado.

A classe gramatical (coluna `classe`) e o bloco (coluna `dia`) de cada palavra
são usados pelo Relâmpago para escolher o distrator — palavra nova sem classe
correta piora o jogo.

**Sorteio da palavra nova do dia (`nextNewIds`, mudou em 25/09):** não pega
mais sempre a partir do índice mais baixo ainda não aprendida (isso fazia
sempre a mesma sequência depois de zerar — reclamação dele). Agora sorteia
dentro de `JANELA_NOVAS` (150) palavras não aprendidas mais próximas de onde
ele está, mantendo fácil→difícil por frequência mas variando a ordem exata.
Isso é só pra **palavras** — `fNovas()` (reduções e blocos) continua
sequencial, de propósito, porque aqueles não têm o mesmo problema e ele não
pediu mudar.

⚠️ **Gap conhecido, não bloqueia nada:** `familias.json` (867 famílias) cobre
só as 1200 palavras originais — não foi regerado para as 1800 novas.

---

## Bancos prontos: Leitura e Antecipar não gastam IA (v19)

Pedido dele em 25/09: parar de gastar tokens toda vez que ele usa o sistema.
Solução pra Leitura e Antecipar: banco de conteúdo pré-gerado **uma vez**
(nesta sessão), consumido localmente, zero chamada de IA no uso do dia a dia.
Ele topou 30 dias de conteúdo agora ("depois eu crio mais").

- **Leitura** — `TXT_BANCO`, 60 textos prontos (2/dia × 30 dias, a meta atual
  `GOAL_TXT`), formato `{titulo, ctx, linhas:[[en,fon,pt],...]}`, mesmo
  formato que a IA sempre devolveu. `gerarTexto()` primeiro chama
  `txtBancoEscolher()` — sorteia um texto do banco evitando repetir os que
  ainda estão nos 12 mais recentes guardados (`S.txt`); só cai na geração ao
  vivo (a função original, com `sampleRef`) se `TXT_BANCO` estiver vazio.
  Como recicla (não há bloqueio depois de esgotar), o custo fica zero pra
  sempre, mesmo que ele use por mais de 30 dias sem eu voltar a gerar mais.
- **Antecipar** — `ANT_BANCO`, 150 itens prontos (ele pediu esse número,
  pace de ~5/dia), formato `{ctx, en, alvo, pt}`, mesmo formato do
  `antPrompt()`. `antGerar()` primeiro chama `antBancoRodada()` — sorteia
  8 (`ANT_ITENS`) sem repetir até esgotar os 150, revalida cada item pela
  mesma regra da IA (alvo tem que aparecer na frase); só cai na geração ao
  vivo se o banco não render pelo menos 3 itens válidos.
- **"Ver tradução"** (pedido junto, 25/09): ele achou o Antecipar difícil no
  modo puro contexto→palavra. Novo botão na tela de aposta (ao lado de
  "Revelar uma letra") mostra `it.pt` — a tradução da frase — como ajuda
  extra, pra quem quiser adivinhar a palavra a partir do significado em vez
  de só do contexto em inglês. Opcional, não mexe em nada da pontuação.

Os dois bancos foram escritos por um agente cada (não 6 em paralelo — só 2,
um pra cada tipo de conteúdo, rodando ao mesmo tempo). O de Leitura usou os
2 textos reais já gerados pelo sistema (`/tmp/leitura_exemplos.json`, tirados
do banco de dados dele) como referência de formato e calibragem fonética.

**Se algum dia os bancos esgotarem e ele quiser mais:** gerar novo
`txt_banco.json`/`ant_banco.json` no mesmo formato (ver os arquivos em
`expansao-3000/` como exemplo) e rodar `build.py` de novo — os placeholders
`/*__TXTBANCO__*/[]` e `/*__ANTBANCO__*/[]` no template aceitam substituição
igual aos de palavras/reduções/blocos.

---

## Relâmpago (v18)

Treino de **velocidade de reconhecimento**, não de memória: 30 segundos, uma
palavra, duas opções, nos dois sentidos (inglês→português e português→inglês).

Regras que não podem ser quebradas:

- **Não toca na agenda de revisão.** Não avança estágio, não mexe em `n`, `s`,
  `e` ou `a`, não conta como palavra nova nem como revisão do dia.
- O único cruzamento é opt-in: no fim da rodada um botão marca `w.r`
  (reforço) só nas erradas que ele **já estuda**.
- O distrator sai da **mesma classe gramatical** e de frequência próxima
  (`|bloco - bloco| <= 8`), e nunca pode ser uma tradução também aceitável.
- **Sorteio aleatório de verdade, no banco inteiro (3000 palavras).**
  `relPool()` embaralha o índice inteiro de `W`, evitando só `rel.recentes`.
  Decisão dele: aplicar só no Relâmpago, não nos blocos/reduções nem nas
  palavras novas do dia (essas seguem janela, ver seção acima) — cada parte
  do sistema com o tipo de variação certo pra ela.
- Recorde de tempo médio só conta com pelo menos 8 acertos na rodada.

Constantes: `REL_SEG`, `REL_RECENTES`, `REL_HIST`, `REL_MIN_TEMPO`.

---

## Antecipar (v19)

Módulo de priming/predição contextual — ilha completamente separada do resto
do sistema (inspirado no exemplo "_arinha" → farinha vs. varinha conforme o
contexto).

Mecânica: frase de contexto empurra pra uma palavra-alvo, ele aposta antes de
revelar. Dica revela do **fim para o começo**. Desde 25/09 também tem "ver
tradução" (ver seção dos bancos, acima) pra quem quiser a ajuda do
significado em vez de só do contexto. Relatório final mostra quantas ele
antecipou **sem nenhuma dica** (a métrica que importa).

Regras que não podem ser quebradas:

- **Isolamento total.** Estado próprio `S.ant`, não toca em `S.w`, `S.r`,
  `S.c` nem nos contadores do dia. Só marca `dias[].ant`.
- **Não entra na grade "hoje" nem em `nextAction()`.**
- Item usado (banco ou IA) é sempre validado: a palavra-alvo precisa
  aparecer de fato na frase em inglês, senão o item é descartado.
- Itens da rodada em aberto (`a.itens`) não são persistidos entre sessões.
- Histórico de rodadas limitado a `ANT_HIST` (40) no pack.
- **Sorteio de palavra-base não foi mexido no pedido de sorteio aleatório**
  — Antecipar já varia por natureza (banco de 150 ou frase nova da IA).

Testado com `test_ant.js` (29) + parte de `test_extra.js` ("ver tradução").

---

## Home: pauta de treinos externos e escrita (v19)

Reaproveita a seção "Treinos de fora" que já existia (sem aba nova):

- **Briefing com YouGlish.** 6 chips com palavras da pauta do dia
  (`pautaHoje(6)`). Cada chip abre `https://youglish.com/pronounce/<palavra
  >/english` — vídeos reais de gente falando aquela palavra.
- **Escrita — traduza pro inglês** (mudou em 25/09: **tirei a correção por
  IA**, ele pediu pra não gastar token nisso). `abrirEscrita()` sorteia uma
  frase pronta de `R` (reduções) ou `C` (blocos) — 480 frases já existentes,
  nenhum conteúdo novo precisou ser gerado — mostra o português como o que
  ele tem que traduzir, ele escreve a tentativa dele, e o botão "Ver
  resposta" revela a frase certa em inglês pra ele comparar sozinho ("aí eu
  vou saber se errei"). Zero chamada de IA, funciona até na cópia offline.
  "Marcar como feito" continua existindo pra quem não quer revelar. Qualquer
  um dos dois marca `dias[].wr = true`.

Testado com `test_extra.js` (28 verificações no total do arquivo).

---

## Verbos frasais (157 itens)

Reaproveita a estrutura já testada de Blocos (mesmo array `C`, mesmo
pack/unpack, mesmos testes) — os 157 entram com `grupo:"Verbos frasais"` e
aparecem como opção no filtro de grupo já existente na aba Frases → Blocos.

---

## Testes

Ficam em `/tmp` e rodam com `node <arquivo>`:

- `test_dados.js` (18) — chaves estáveis, migração, palavra no meio da lista
  não desloca o histórico. **O mais importante.**
- `test_rel.js` (49) — relâmpago completo.
- `test_ant.js` (29) — antecipar: isolamento, dica reversa, persistência.
- `test_extra.js` (28) — pauta do YouGlish, Escrita (traduzir e revelar, sem
  IA), o modal `confirmar()` (prova que zerar realmente zera e que cancelar
  não apaga nada), janela do sorteio de palavra nova, "ver tradução" no
  Antecipar, e que os dois bancos prontos funcionam sem chamar IA nenhuma.
- `test_v13.js` (36) — leitura do dia (inclui o caminho de geração ao vivo,
  com o banco esvaziado de propósito pra esse teste), famílias, vibração.
- `test_v11.js` (26) — imagens, chute, marcos, folgas de sequência.
- `test_frases.js` (28) — reduções, blocos e verbos frasais.
- `t2.js` (22) — modos de revisão de frases, filtro por grupo.
- `t_img.js` (7) — envio de imagem pelo banco de palavras.

Total: 243 verificações. Nenhuma pode falhar antes de publicar.

`test_dados.js`, `test_rel.js` e `test_extra.js` usam o estado real dele
salvo em `/tmp/dbcheck/estado/principal.json`; pra atualizar, ler o banco com
`ArtifactData` e `out_dir`.

`/tmp/shot_rel.js`, `/tmp/shot_ant.js`, `/tmp/shot_novo.js` e `/tmp/shot_v19.js`
tiram telas das partes relevantes.

---

## Reconstruir do zero

O container é efêmero: `/tmp/app_template.html`, os `.txt`/`.json` de
conteúdo e os testes somem quando a sessão morre. Para recuperar:

1. Ler o artifact publicado (`Artifact` action `read`) — o HTML publicado tem
   todo o código e todos os dados embutidos, incluindo `TXT_BANCO`/`ANT_BANCO`.
2. Separar o `<style>`, o `<script>` e os arrays `W`, `R`, `C`, `FAM`,
   `TXT_BANCO`, `ANT_BANCO`.
3. Recriar o template com os marcadores `/*__WORDS__*/[]`, `/*__RED__*/[]`,
   `/*__CHK__*/[]`, `/*__FAM__*/{}`, `/*__TXTBANCO__*/[]`, `/*__ANTBANCO__*/[]`
   e o `build.py` (os dois últimos são opcionais — build funciona com banco
   vazio, só cai na geração ao vivo).

A planilha das 3000 palavras também está na pasta do OneDrive dele.

**Publicar via `Artifact`:** o arquivo passado em `file_path` NÃO pode ter
`<!DOCTYPE>`, `<html>`, `<head>` nem `<body>` — só o `<style>`, o conteúdo do
`<body>` e o `<script>`. O `build.py` já faz isso sozinho e grava o resultado
certo em `/tmp/artifact-fluencia.html` — publicar esse arquivo direto.
Sempre conferir, depois de publicar, que a versão nova está de fato no ar
(aconteceu antes de ficar desatualizado por essa etapa ter sido pulada).

---

## Tarefa agendada

**Backup diário do sistema de inglês** (`trig_01JDRCKVhcAGjmHeqqPyJtBL`) —
todo dia às 22:17 de Brasília. Lê o banco, grava
`Backups\backup-AAAA-MM-DD.json` no computador dele. Exige o computador ligado;
se estiver fora do ar, pula o dia sem tentar de novo. Se o progresso tiver
encolhido em relação ao backup anterior, grava com sufixo `-SUSPEITO` e avisa,
em vez de sobrescrever.

---

## PENDÊNCIAS

### Aguardando decisão dele antes de executar

- **"Zerar o sistema para começar a contagem a partir de hoje"** (pedido
  original em 25/09). O botão "Zerar tudo" agora **funciona** (era o bug do
  confirm() — corrigido), então ele já pode fazer isso sozinho quando quiser.
  Mas a pergunta original de escopo continua sem resposta, caso ele queira
  que EU faça: (a) zerar só contadores de dia/sequência preservando palavras
  aprendidas, ou (b) apagar tudo. O botão que existe faz (b). Se ele pedir
  pra mim, ainda preciso confirmar qual das duas antes de agir — é
  irreversível.

### Concluídas em 26/09 (v20) — saindo da lista de pendências

1. ~~Texto de Leitura concluído não ficava marcado como lido.~~ Push
   imediato (`flushPush()`) no clique de "Terminei", em vez de esperar o
   debounce de 1200ms. Ver seção própria.

### Concluídas em 25/09 (v19) — saindo da lista de pendências

1. ~~Bug do confirm() bloqueado.~~ Corrigido nos 9 lugares. Ver seção própria.
2. ~~Não gastar mais tokens no uso diário.~~ Leitura e Antecipar rodam de
   banco pronto (60 textos, 150 itens, 30 dias). Escrita não usa mais IA
   nenhuma (reaproveita reduções/blocos existentes). Ver seção dos bancos.
3. ~~Sorteio aleatório também nas palavras novas do dia.~~ Feito, em janela
   de 150 pra manter a curva de dificuldade (ele confirmou essa opção em vez
   de sorteio livre no banco inteiro).
4. ~~"Ver tradução" no Antecipar.~~ Feito — ele achou o modo puro contexto
   difícil demais, pediu esse apoio extra.

---

## Decisões já tomadas (não reabrir sem ele pedir)

- **Áudio está fora.** Gerador em `/tmp/gerar_audio.py` se um dia voltar.
- **Não existe aba de conversa com IA.**
- **O PAV não é aposentado automaticamente.**
- **Sem pontos, medalhas ou ranking entre pessoas.**
- A camada de motivação aprovada é: lacuna de curiosidade, fim de sessão em
  alta, vibração, metas curtas, folgas de sequência e os recordes do relâmpago.
- **Sorteio aleatório**: Relâmpago (banco inteiro) e palavras novas do dia
  (janela de 150). Blocos e reduções continuam sequenciais — cadência de
  revisão espaçada ali é proposital.
- **Custo de IA no uso diário**: banco pronto primeiro (Leitura, Antecipar),
  geração ao vivo só como reserva se o banco acabar. Escrita não usa IA de
  jeito nenhum — reaproveita conteúdo que já existe. Qualquer feature nova
  que dependeria de `sampleRef` toda vez deve, por padrão, considerar essa
  mesma estratégia (banco pronto) antes de assumir custo recorrente.
- **`confirmar()` (modal próprio) em vez de `confirm()` nativo** — o
  segundo não funciona no Artifact publicado (iframe sandboxed).
- **Ações importantes que marcam algo como concluído (ex.: leitura "lida")
  forçam `flushPush()` na hora**, em vez de confiar só no debounce de push —
  ver seção de sincronização (v20).

---

## Ideias apresentadas e recusadas

Medidor de cobertura de texto, leitura estreita, contador de encontros, 4/3/2,
diário de três frases, produção sob pressão, agenda adaptativa, intercalação,
autoexplicação, palavras próprias, teste de fluência mensal, identidade,
compromisso declarado, ritual de retorno, bônus imprevisível.

Não reapresentar sem ele puxar o assunto.
