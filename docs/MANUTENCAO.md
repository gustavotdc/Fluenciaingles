# Manutenção e restauração (atualizado em 23/10/2026)

Arquivo para qualquer sessão do Claude continuar o trabalho. Não contém senhas nem chaves secretas.

## Arquitetura
- Código: GitHub `gustavotdc/Fluenciaingles` (branch `main`). Push em `main` publica sozinho no GitHub Pages e no Cloudflare Pages (`fluenciaingles.pages.dev`; build `pip install openpyxl && python3 src/build.py`, saída `dist`).
- App: um HTML só (`src/app_template.html`) + `src/build.py` + dados em `data/`.
- Dados do usuário: Supabase (projeto `iopcocewxebrsiyqqezx`), tabela `estado`, linha `id='principal'`, coluna `dados` (jsonb).
- Login: Supabase Auth (e-mail + senha). Sessão em `localStorage` (`fluencia_auth`). O login só é exigido no site (https fora do localhost).

## Como o progresso é protegido
1. **Mesclagem no app** (`mesclar`, `sincroniza` em `app_template.html`): antes de gravar, busca a nuvem, junta (palavras e dias somam; vence a palavra mais avançada) e grava de forma condicional por `atualizado_em`. Falha de rede = não grava, tenta de novo.
2. **Trava no banco** (função `estado_arquivar`, gatilho `estado_arquivar_trg` em `estado`): recusa gravação que reduza as palavras (`dados->'w'`) em mais da metade quando já há 10 ou mais. Para um reset autorizado, gravar com `dados._reset_autorizado = 'sim'`.
3. **Histórico no banco** (`estado_historico`): cópia da versão anterior quando as palavras caem e a cada 6 h. Para restaurar: copiar `dados` da linha desejada de `estado_historico` para `estado` (SQL Editor do Supabase).
4. **"Zerar tudo" desativado no app.** Zerar só pelo Claude, e antes copiar o estado para `estado_historico`.

## Pendências de segurança (ver `_SYNC.md` do Project)
- Depois que o dono criar a conta no app: trocar as políticas públicas da tabela `estado` por uma política só para o `auth.uid()` dele, e desligar novos cadastros no Supabase (Authentication → Sign In / Providers). Até lá o banco ainda aceita escrita com a chave pública.
- Backup diário externo (Google Drive) e repositório privado: pendentes.

## Testes
`NODE_PATH=$(npm root -g) PW_CHROMIUM=<caminho do chromium> node tests/<arquivo>.js` (Playwright). Sync e login: `python3 tests/test_sync_multidispositivo.py`. Nada publica com teste falhando.
