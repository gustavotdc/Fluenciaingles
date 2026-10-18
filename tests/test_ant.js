const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

/* O módulo "Antecipar" foi removido do sistema (pedido dele, 16/10 — ele não
   usava). Este teste não cobre mais a feature em si (ela não existe mais):
   cobre só que a remoção foi limpa (sem aba, sem rota, sem resíduo de UI) e
   que o campo "ant" do estado persistido continua intacto e compatível —
   nunca se remove campo salvo, mesmo de feature desativada (ver arquitetura). */

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|TUNNEL/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };

  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto(APP);
  await p.waitForTimeout(500);

  // ---------- a aba/rota foi removida de verdade ----------
  const removido = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('home');
    const temTab = TABS.some(t => t[0] === 'ant');
    go('ant');                                  // rota inexistente: não pode quebrar nem renderizar algo
    const telaVazia = $('#view').innerHTML.trim().length === 0 || !/Antecipar/.test($('#view').textContent);
    return { temTab, telaVazia };
  }, REAL);
  ok(!removido.temTab, 'aba "Antecipar" não existe mais em TABS');
  ok(removido.telaVazia, 'navegar pra rota "ant" não renderiza a tela antiga nem quebra');

  const funcoesRemovidas = await p.evaluate(() => ({
    viewAnt: typeof viewAnt, startAntecipar: typeof startAntecipar, antGerar: typeof antGerar,
    AnteciparSession: typeof AnteciparSession, temAntecipar: typeof temAntecipar,
  }));
  ok(Object.values(funcoesRemovidas).every(t => t === 'undefined'), 'funções do módulo antigo (viewAnt, startAntecipar, antGerar, AnteciparSession, temAntecipar) não existem mais');

  const naoInterfere = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('home');
    const t = document.querySelector('#view').textContent;
    return { temAntecipar: /Antecipar/.test(t), acaoIgnoraAnt: nextAction().t !== 'ant' };
  }, REAL);
  ok(!naoInterfere.temAntecipar, '"Antecipar" não aparece em lugar nenhum da Home');
  ok(naoInterfere.acaoIgnoraAnt, 'nextAction() nunca aponta para "ant"');

  // ---------- campo persistido "ant" continua intacto (nunca remover campo salvo) ----------
  const fresh = await p.evaluate(() => {
    S = freshState();
    return { ant: JSON.stringify(S.ant) };
  });
  ok(fresh.ant === '{"feitas":0,"cheios":0,"perto":0,"rodadas":[],"itens":null,"i":0}', 'freshState ainda inicia S.ant zerado (campo não foi removido do formato)');

  const antigoSemAnt = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.ant;
    const v = normaliza(unpack(copia));
    return { ant: JSON.stringify(v.ant), diaAnt: v.dias[Object.keys(v.dias)[0]].ant };
  }, REAL);
  ok(antigoSemAnt.ant === '{"feitas":0,"cheios":0,"perto":0,"rodadas":[],"itens":null,"i":0}', 'save antigo sem "ant" ainda abre sem erro');
  ok(antigoSemAnt.diaAnt === 0, 'dias antigos ainda ganham o contador "ant" zerado');

  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.ant = { feitas: 40, cheios: 25, perto: 0, rodadas: [[1700000000000, 8, 6, 4], [1700000001000, 8, 7, 5]], itens: null, i: 0 };
    today().ant = 3;
    const g = pack();
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { feitas: v.ant.feitas, cheios: v.ant.cheios, rodadas: v.ant.rodadas.length, dia: v.dias[dayKey()].ant };
  }, REAL);
  ok(persist.feitas === 40 && persist.cheios === 25, 'feitas/cheios de um histórico antigo voltam intactos do pack/unpack');
  ok(persist.rodadas === 2, 'histórico de rodadas antigo volta intacto');
  ok(persist.dia === 3, 'contador do dia "ant" antigo volta intacto');

  const limite = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.ant.rodadas = Array.from({ length: 60 }, (_, i) => [i, 8, 6, 4]);
    const g = pack();
    return { salvas: g.ant.r.length };
  }, REAL);
  ok(limite.salvas === 40, `histórico de rodadas antigo ainda fica limitado a ANT_HIST=40 no pack (${limite.salvas})`);

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
