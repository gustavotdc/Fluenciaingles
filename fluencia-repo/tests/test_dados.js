const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA') + '  ' + m);
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto(APP);
  await p.waitForTimeout(600);

  // ---------- o estado real dele volta inteiro ----------
  const real = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const primeiro = Object.keys(S.w)[0];
    return {
      palavras: Object.keys(S.w).length,
      dias: Object.keys(S.dias).length,
      red: Object.keys(S.r).length, chk: Object.keys(S.c).length,
      img: Object.keys(S.img).length, txt: S.txt.length,
      orfas,
      hoje: S.dias['2026-09-23'],
      amostra: { i: primeiro, palavra: W[primeiro][2], est: S.w[primeiro] }
    };
  }, REAL);
  ok(real.palavras === 27 && real.dias === 3, `o estado real dele volta: ${real.palavras} palavras, ${real.dias} dias`);
  ok(real.red === 3 && real.chk === 5 && real.img === 1 && real.txt === 2,
    `reduções ${real.red}, blocos ${real.chk}, imagem ${real.img}, textos ${real.txt}`);
  ok(real.hoje.novas === 25 && real.hoje.red === 3 && real.hoje.chk === 5 && real.hoje.txt === 2,
    'o dia 23/09 volta certo: ' + JSON.stringify(real.hoje));
  ok(real.orfas === 0, 'nenhum registro órfão no estado antigo');

  // ---------- migração: formato antigo (índice) -> novo (palavra) ----------
  const mig = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const novo = pack();
    const chaves = Object.keys(novo.w);
    return { f: novo.f, cv: novo.cv, primeira: chaves[0], numerica: chaves.every(k => /^\d+$/.test(k)),
             img: Object.keys(novo.img)[0], r: Object.keys(novo.r)[0], c: Object.keys(novo.c)[0] };
  }, REAL);
  ok(mig.f === 4 && !mig.numerica, `ao gravar já sai no formato novo (f${mig.f}), chave "${mig.primeira}"`);
  ok(mig.cv === '3000/67/413', 'o documento registra de que conteúdo ele veio: ' + mig.cv);
  ok(/[a-z]/.test(mig.img) && /[a-z]/.test(mig.r) && /[a-z]/.test(mig.c),
    `imagem, redução e bloco também viram texto: "${mig.img}" / "${mig.r}" / "${mig.c}"`);

  // ---------- ida e volta no formato novo ----------
  const rt = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antes = JSON.stringify(S.w);
    const volta = unpack(JSON.parse(JSON.stringify(pack())));
    return { igual: JSON.stringify(volta.w) === antes, orfas, img: volta.img, dias: JSON.stringify(volta.dias) === JSON.stringify(S.dias) };
  }, REAL);
  ok(rt.igual && rt.dias && rt.orfas === 0, 'grava e lê de volta sem perder nada');

  // ---------- A PROVA: inserir palavras novas NÃO desloca o histórico ----------
  const prova = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    // fotografa o que ele sabe hoje, por palavra
    const antes = {};
    for (const i in S.w) antes[W[i][2]] = JSON.stringify(S.w[i]);
    const gravado = pack();

    // simula uma atualização futura: 3 palavras novas ENFIADAS NO MEIO da lista
    const novas = [['teste um', 'TÉST', 'zzztest1', 'pav', 'substantivo', 49],
                   ['teste dois', 'TÉST', 'zzztest2', 'pav', 'substantivo', 49],
                   ['teste três', 'TÉST', 'zzztest3', 'pav', 'substantivo', 49]];
    W.splice(5, 0, ...novas);
    // reconstrói os índices, como aconteceria ao abrir a versão nova
    for (const k in ixW) delete ixW[k];
    for (let i = 0; i < W.length; i++) ixW[String(W[i][2]).toLowerCase()] = i;

    const depois = unpack(gravado);
    const conferido = {};
    for (const i in depois.w) conferido[W[i][2]] = JSON.stringify(depois.w[i]);

    const iguais = Object.keys(antes).every(k => antes[k] === conferido[k]);
    const nOk = Object.keys(antes).length === Object.keys(conferido).length;
    return { iguais, nOk, n: Object.keys(antes).length, orfas, total: W.length,
             exemplo: Object.keys(antes)[0], desloc: JSON.stringify(depois.w) !== JSON.stringify(S.w) };
  }, REAL);
  ok(prova.total === 3003, 'lista cresceu para ' + prova.total + ' palavras, com 3 enfiadas no meio');
  ok(prova.iguais && prova.nOk && prova.orfas === 0,
    `todas as ${prova.n} palavras continuam com o histórico certo depois da atualização`);
  ok(prova.desloc === true, 'os índices internos mudaram (prova de que o remapeamento agiu, não foi sorte)');

  // ---------- e o que acontece se uma palavra for REMOVIDA ----------
  const removida = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const gravado = pack();
    const alvo = Object.keys(gravado.w)[0];
    delete gravado.w[alvo];                 // some do banco
    const v1 = unpack(gravado);
    const n1 = Object.keys(v1.w).length;
    // agora o contrário: o banco tem uma palavra que a lista não tem mais
    const g2 = pack();
    g2.w['palavra-que-nao-existe-mais'] = [3, 0, 1, 0, 1, 0, 0];
    const v2 = unpack(g2);
    return { n1, semQuebrar: !!v2, orfas, n2: Object.keys(v2.w).length };
  }, REAL);
  ok(removida.semQuebrar && removida.orfas === 1,
    'registro de palavra que não existe mais é contado como órfão (' + removida.orfas + '), não quebra nada');

  // ---------- localStorage também no formato estável ----------
  const ls = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    try { localStorage.removeItem('fluencia_v1'); } catch (e) {}
    save();
    const cru = JSON.parse(localStorage.getItem('fluencia_v1'));
    return { f: cru.f, numerica: Object.keys(cru.w).every(k => /^\d+$/.test(k)) };
  }, REAL);
  ok(ls.f === 4 && !ls.numerica, 'o navegador também guarda no formato estável (f' + ls.f + ')');

  // ---------- estado cru muito antigo ainda abre ----------
  const cru = await p.evaluate(() => {
    const velho = { v: 1, criado: 1, ultimo: 2, w: { 0: { s: 3, n: 1, l: 1, e: 0, a: 2, m: false, r: false } },
                    dias: { '2026-01-01': { novas: 5, revs: 2, dom: 0, li: true, sp: false, gr: false, limpo: true } }, pav: {} };
    const o = normaliza(velho.f ? unpack(velho) : velho);
    return { w: Object.keys(o.w).length, img: !!o.img, txt: Array.isArray(o.txt) };
  });
  ok(cru.w === 1 && cru.img && cru.txt, 'estado cru de versões antigas ainda abre');

  // ---------- painel de saúde ----------
  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('cfg'); }, REAL);
  await p.waitForTimeout(300);
  const painel = await p.textContent('#view');
  ok(/Saúde dos dados/.test(painel), 'aba Dados abre com o painel de saúde');
  ok(/27 palavras em estudo/.test(painel.replace(/\s+/g, ' ')), 'painel conta o que ele tem');
  ok(/nenhum — todo o seu histórico casa/.test(painel), 'painel confirma que não há registro perdido');
  ok(/3000 palavras · 67 reduções · 413 blocos/.test(painel.replace(/\s+/g, ' ')), 'painel mostra a versão do conteúdo');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  await b.close();
  process.exit(0);
})();
