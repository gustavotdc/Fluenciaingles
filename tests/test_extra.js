const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|TUNNEL/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };

  await p.addInitScript(() => {
    window.__jsonCalls = 0;
    window.claude = {
      use: async (kind) => kind === 'sample' ? ({
        json: async () => { window.__jsonCalls++; return { itens: [{ ctx: 'x', en: 'y', alvo: 'z', pt: 'w' }] }; }
      }) : null
    };
  });
  await p.goto(APP);
  await p.waitForTimeout(500);

  // ---------- pauta pro YouGlish ----------
  const pauta = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const p1 = pautaHoje(6);
    return { n: p1.length, unicos: new Set(p1).size, todasValidas: p1.every(i => W[i] && W[i][2]) };
  }, REAL);
  ok(pauta.n > 0 && pauta.n <= 6, `pautaHoje devolve ${pauta.n} palavras`);
  ok(pauta.unicos === pauta.n && pauta.todasValidas, 'sem repetição e todas com palavra válida');

  const pautaVazia = await p.evaluate(() => { S = freshState(); return pautaHoje(6).length; });
  ok(pautaVazia >= 0, 'pautaHoje não quebra com base zerada (' + pautaVazia + ')');

  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('home'); }, REAL);
  await p.waitForTimeout(100);
  const home = await p.evaluate(() => {
    const links = [...document.querySelectorAll('.treinos a.edt')];
    return { n: links.length, hrefOk: links.every(a => a.href.startsWith('https://youglish.com/pronounce/')), temEscrita: !!document.querySelector('#bEsc') };
  });
  ok(home.n > 0 && home.hrefOk, `home mostra ${home.n} links pro YouGlish, todos apontando certo`);
  ok(home.temEscrita, 'botão de Escrita aparece nos treinos de fora');

  // ---------- escrita: traduzir e revelar (sem IA) ----------
  await p.click('#bEsc');
  await p.waitForTimeout(80);
  const antes = await p.evaluate(() => !!today().wr);
  ok(!antes, 'dia começa sem escrita marcada como feita');
  const promptOk = await p.evaluate(() => /Escreva em inglês:/.test(document.querySelector('.modal .mini').textContent));
  ok(promptOk, 'mostra a frase em português pra traduzir, sem chamar IA');

  await p.fill('#escTxt', 'minha tentativa');
  await p.click('#escGo');
  await p.waitForTimeout(80);
  const depois = await p.evaluate(() => ({
    wr: !!today().wr,
    revelou: !!document.querySelector('#escRes').textContent.trim()
  }));
  ok(depois.wr, '"ver resposta" marca o dia como feito');
  ok(depois.revelou, 'revela a frase em inglês já pronta (banco de reduções/blocos)');
  await p.click('#x');

  // ---------- marcar como feito sem revelar também funciona ----------
  await p.evaluate(() => { S = freshState(); go('home'); });
  await p.waitForTimeout(80);
  await p.click('#bEsc');
  await p.waitForTimeout(50);
  await p.click('#escOk');
  await p.waitForTimeout(50);
  const marcado = await p.evaluate(() => !!today().wr);
  ok(marcado, '"marcar como feito" funciona sem revelar a resposta');

  // ---------- persistência do campo wr ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    today().wr = true;
    const g = pack();
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { wr: v.dias[dayKey()].wr };
  }, REAL);
  ok(persist.wr === true, 'campo "wr" do dia sobrevive ao pack/unpack');

  const antigo = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    for (const k in copia.dias) copia.dias[k] = copia.dias[k].slice(0, 11); // sem o índice 12 (wr)
    const v = normaliza(unpack(copia));
    return v.dias[Object.keys(v.dias)[0]].wr;
  }, REAL);
  ok(antigo === false, 'save antigo sem campo "wr" abre com false, sem erro');

  // ---------- confirmar() em vez de confirm() nativo: zerar funciona ----------
  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('cfg'); }, REAL);
  await p.waitForTimeout(100);
  const antesZerar = await p.evaluate(() => Object.keys(S.w).length);
  ok(antesZerar > 0, `estado real tem ${antesZerar} palavras antes de zerar`);
  await p.click('#zerar');
  await p.waitForTimeout(80);
  const modalUm = await p.evaluate(() => !!document.querySelector('.modal'));
  ok(modalUm, 'clicar em "Zerar tudo" abre modal próprio (não trava em confirm() bloqueado)');
  await p.click('.modal #cfS');
  await p.waitForTimeout(80);
  const modalDois = await p.evaluate(() => !!document.querySelector('.modal'));
  ok(modalDois, 'pede a segunda confirmação antes de apagar');
  await p.click('.modal #cfS');
  await p.waitForTimeout(120);
  const depoisZerar = await p.evaluate(() => Object.keys(S.w).length);
  ok(depoisZerar === 0, 'confirmando as duas vezes, zera o progresso de verdade');

  // cancelar não apaga nada
  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('cfg'); }, REAL);
  await p.waitForTimeout(80);
  await p.click('#zerar');
  await p.waitForTimeout(80);
  await p.click('.modal #cfN');
  await p.waitForTimeout(80);
  const cancelou = await p.evaluate(() => Object.keys(S.w).length);
  ok(cancelou > 0, 'cancelar no modal não apaga o progresso');

  // ---------- sorteio das palavras novas: janela, não sempre a mesma ordem ----------
  const janela = await p.evaluate(() => {
    S = freshState();
    const a = nextNewIds(25).slice().sort((x, y) => x - y);
    const janelaOk = a[a.length - 1] < JANELA_NOVAS;
    let diferente = false;
    for (let t = 0; t < 8; t++) {
      const b = nextNewIds(25);
      if (JSON.stringify(b) !== JSON.stringify(nextNewIds(25))) { diferente = true; break; }
    }
    return { n: a.length, janelaOk, diferente, unicos: new Set(a).size === a.length };
  });
  ok(janela.n === 25 && janela.unicos, `nextNewIds devolve 25 palavras sem repetir (${janela.n})`);
  ok(janela.janelaOk, 'todas dentro da janela de palavras não aprendidas mais próximas');
  ok(janela.diferente, 'ordem varia entre chamadas (não é sempre a sequência 0,1,2...)');

  // ---------- antecipar: "ver tradução" ----------
  await p.evaluate(() => {
    S = freshState();
    antEstado().itens = [{ ctx: 'The pilot checks the fuel.', en: 'The plane is ready to take off.', alvo: 'take', pt: 'O avião está pronto para decolar.' }];
    startAntecipar();
  });
  await p.waitForTimeout(100);
  const antesTraducao = await p.evaluate(() => !document.querySelector('.ant-pt'));
  ok(antesTraducao, 'tradução não aparece por padrão na aposta');
  await p.click('#ptOn');
  await p.waitForTimeout(80);
  const depoisTraducao = await p.evaluate(() => {
    const el = document.querySelector('.ant-pt');
    return el && el.textContent.includes('decolar');
  });
  ok(depoisTraducao, '"Ver tradução" revela o português pra ajudar a adivinhar a palavra');

  // ---------- bancos prontos: leitura e antecipar sem gastar IA ----------
  const bancos = await p.evaluate(() => ({ txt: TXT_BANCO.length, ant: ANT_BANCO.length }));
  ok(bancos.txt === 60, `banco de leitura tem 60 textos prontos (tem ${bancos.txt})`);
  ok(bancos.ant === 150, `banco de antecipar tem 150 itens prontos (tem ${bancos.ant})`);

  const leituraBanco = await p.evaluate(() => new Promise(res => {
    S = freshState();
    const antes = window.__jsonCalls;
    gerarTexto(() => res({ ok: true, chamouIA: window.__jsonCalls !== antes, n: S.txt.length, temLinhas: S.txt[0].l.length >= 3 }),
               () => res({ ok: false }));
  }));
  ok(leituraBanco.ok && !leituraBanco.chamouIA, 'gerarTexto() usa o banco pronto, sem chamar a IA');
  ok(leituraBanco.n === 1 && leituraBanco.temLinhas, 'texto do banco entra em S.txt no formato certo');

  const anteciparBanco = await p.evaluate(() => new Promise(res => {
    S = freshState();
    const antes = window.__jsonCalls;
    antGerar(() => { const a = antEstado(); res({ ok: true, chamouIA: window.__jsonCalls !== antes, n: a.itens.length, campos: a.itens.every(i => i.ctx && i.en && i.alvo && i.pt) }); },
             () => res({ ok: false }));
  }));
  ok(anteciparBanco.ok && !anteciparBanco.chamouIA, 'antGerar() usa o banco pronto, sem chamar a IA');
  ok(anteciparBanco.n === 8 && anteciparBanco.campos, 'rodada do banco vem com 8 itens completos');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
