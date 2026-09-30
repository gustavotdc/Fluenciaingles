# Fluência — Inglês

Sistema pessoal de memorização de vocabulário (método PAV) do Gustavo.

## Estrutura

- `src/app_template.html` — código-fonte do app (HTML/CSS/JS, um arquivo só).
- `src/build.py` — junta o template com os dados de `data/` e gera `dist/index.html`.
- `data/` — palavras (planilha), reduções, blocos, famílias, bancos prontos de
  Leitura e Antecipar, e um estado de exemplo (`estado_exemplo.json`) usado
  só pelos testes.
- `tests/` — suíte de testes (Playwright + Node), 243 verificações no total.
- `docs/arquitetura-do-sistema.md` — documento de referência completo:
  decisões, regras que não podem ser quebradas, pendências.
- `.github/workflows/deploy.yml` — gera `dist/index.html` e publica no
  GitHub Pages a cada push em `main`.

## Gerar o app localmente

```
pip install openpyxl
python3 src/build.py
```

Gera `dist/index.html` — abra direto no navegador.

## Rodar os testes

Precisa do Playwright instalado (`npm install playwright`) e de um Chromium
disponível. Se o Chromium não estiver no caminho padrão, aponte com a
variável `PW_CHROMIUM`:

```
PW_CHROMIUM=/caminho/para/chromium node tests/test_dados.js
```

Rodar todos:

```
npm test
```

Nenhum teste pode falhar antes de publicar uma mudança.

## Publicar

Um push em `main` já gera e publica em GitHub Pages automaticamente (ver
`.github/workflows/deploy.yml`). Precisa habilitar uma vez em
**Settings → Pages → Source: GitHub Actions**.
