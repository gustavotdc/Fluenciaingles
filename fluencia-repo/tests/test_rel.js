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
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto(APP);
  await p.waitForTimeout(500);

  // ---------- sorteio ----------
  // pedido dele em 25/09: aleatório de verdade no banco inteiro (3000),
  // sem priorizar estudadas nem travar nas mais frequentes.
  const pool = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const a = relPool(), b = relPool();
    return { n: a.length, unicos: new Set(a).size,
             diferente: a.slice(0, 15).join() !== b.slice(0, 15).join(),
             todosValidos: a.every(i => W[i] && W[i][2]),
             cobreOBanco: new Set(a.slice(0, 200)).size > 0 && a.some(i => i >= 1200) };
  }, REAL);
  ok(pool.n >= 30 && pool.todosValidos, `sorteio devolve ${pool.n} palavras válidas`);
  ok(pool.unicos === pool.n, 'nenhuma palavra repetida dentro da mesma rodada');
  ok(pool.diferente, 'duas rodadas seguidas não sorteiam a mesma sequência');
  ok(pool.cobreOBanco, 'sorteio alcança as palavras novas do banco (índice >= 1200), não só as mais frequentes');

  // com a base pequena de hoje, o sorteio funciona igual — não depende de estudo prévio
  const completa = await p.evaluate(() => {
    S = freshState();                       // ninguém estudou nada ainda
    const a = relPool();
    const dist = new Set(a.map(i => Math.floor(i / 500))).size;   // faixas de 500 no banco de 3000
    return { n: a.length, unicos: new Set(a).size, dist };
  });
  ok(completa.n >= 30 && completa.unicos === completa.n, `base zerada ainda gera rodada (${completa.n} palavras)`);
  ok(completa.dist >= 4, `com base zerada o sorteio ainda cobre várias faixas do banco de 3000 (${completa.dist}/6 faixas)`);

  // ---------- distrator ----------
  const dist = await p.evaluate(() => {
    S = freshState();
    let mesmaClasse = 0, colidiu = 0, nulo = 0, total = 0, perto = 0;
    for (let k = 0; k < 400; k++) {
      const id = Math.floor(Math.random() * W.length);
      const d = relDistrator(id, new Set([id]));
      if (d == null) { nulo++; continue; }
      total++;
      if (W[d][4] === W[id][4]) mesmaClasse++;
      if (Math.abs(W[d][5] - W[id][5]) <= 8) perto++;
      // o distrator nunca pode ser uma resposta também aceitável
      const tok = t => String(t).toLowerCase().split(/[\/,;()\s]+/).filter(x => x.length > 2);
      if (tok(W[id][0]).some(t => tok(W[d][0]).indexOf(t) >= 0)) colidiu++;
      if (W[d][2].toLowerCase() === W[id][2].toLowerCase()) colidiu++;
    }
    return { mesmaClasse, colidiu, nulo, total, perto };
  });
  ok(dist.nulo === 0, 'sempre acha um distrator');
  ok(dist.mesmaClasse === dist.total, `distrator sempre da mesma classe gramatical (${dist.mesmaClasse}/${dist.total})`);
  ok(dist.perto / dist.total > 0.9, `distrator de frequência parecida em ${Math.round(dist.perto / dist.total * 100)}% dos casos`);
  ok(dist.colidiu === 0, 'nenhum distrator é uma tradução também aceitável (senão o "erro" seria injusto)');

  // ---------- a rodada ----------
  await p.evaluate(doc => { S = normaliza(unpack(doc)); startRelampago(); }, REAL);
  await p.waitForTimeout(150);
  ok(/Quantas você faz em 30 segundos/.test(await p.textContent('#view')), 'tela inicial abre com a regra do jogo');

  await p.click('#vai');
  await p.waitForTimeout(2200);                       // 3 · 2 · 1
  const jogo = await p.evaluate(() => ({
    ops: document.querySelectorAll('.rel-op').length,
    alvo: document.querySelector('.rel-alvo').textContent.trim(),
    dir: document.querySelector('.rel-dir').textContent.trim(),
    seg: parseFloat(document.querySelector('#relSeg').textContent)
  }));
  ok(jogo.ops === 2 && jogo.alvo.length > 0, `carta com a palavra "${jogo.alvo}" e 2 opções`);
  ok(jogo.seg > 26 && jogo.seg <= 30, `relógio correndo em ${jogo.seg}s`);

  // dois sentidos aparecem
  const dirs = await p.evaluate(async () => {
    const vistos = {};
    for (let i = 0; i < 24; i++) {
      vistos[document.querySelector('.rel-dir').textContent.trim()] = 1;
      SESSION.responder(true);
    }
    return Object.keys(vistos);
  });
  ok(dirs.length === 2, 'sorteia nos dois sentidos: ' + dirs.join(' e '));

  // a barra encolhe junto com o relógio
  const barra = await p.evaluate(() => parseFloat(document.querySelector('#relBar').style.width));
  ok(barra < 100 && barra > 0, `barra do tempo acompanhando (${barra.toFixed(0)}%)`);

  // ---------- placar, sequência e tempo ----------
  const partida = await p.evaluate(() => {
    SESSION.acertos = 0; SESSION.erros = 0; SESSION.seq = 0; SESSION.melhorSeq = 0; SESSION.itens = [];
    [true, true, true, false, true, true, true, true, true, false].forEach(r => SESSION.responder(r));
    return { a: SESSION.acertos, e: SESSION.erros, seq: SESSION.melhorSeq, n: SESSION.itens.length,
             tempos: SESSION.itens.every(x => x.ms >= 0) };
  });
  ok(partida.a === 8 && partida.e === 2, `placar certo: ${partida.a} acertos, ${partida.e} erros`);
  ok(partida.seq === 5, `maior sequência calculada certa: ${partida.seq}`);
  ok(partida.n === 10 && partida.tempos, 'cada resposta guarda o tempo de reação');

  // ---------- o relatório do fim ----------
  const fim = await p.evaluate(() => {
    SESSION.encerrar();
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    const erradas = SESSION.itens.filter(x => !x.ok);
    return { t,
      linhas: document.querySelectorAll('.rel-l').length,
      ruins: document.querySelectorAll('.rel-l.bad').length,
      boas: document.querySelectorAll('.rel-l.ok').length,
      temBotaoRef: !!document.querySelector('#relRef'),
      mostraMarcou: /marcou/.test(t),
      primeiroErro: erradas.length ? W[erradas[0].id][2] : null,
      oQueMarcou: erradas.length ? (erradas[0].dir === 'en' ? W[erradas[0].dist][0] : W[erradas[0].dist][2]) : null,
      pron: erradas.length ? W[erradas[0].id][1] : null,
      trad: erradas.length ? W[erradas[0].id][0] : null };
  });
  ok(fim.linhas === 10 && fim.ruins === 2 && fim.boas === 8, `relatório lista as 10: ${fim.ruins} erradas, ${fim.boas} certas`);
  ok(/8\s*acertos/.test(fim.t) && /2\s*erros/.test(fim.t), 'relatório mostra o placar');
  ok(/maior sequência/.test(fim.t) && /tempo médio/.test(fim.t), 'relatório traz sequência e tempo médio');
  ok(fim.mostraMarcou, 'nos erros, mostra o que ele marcou');
  const baixo = fim.t.toLowerCase();
  ok(baixo.indexOf(fim.primeiroErro) >= 0 && baixo.indexOf(fim.trad) >= 0 && baixo.indexOf(fim.pron.toLowerCase()) >= 0,
    `cada linha traz inglês, pronúncia e tradução ("${fim.primeiroErro}" · ${fim.pron} · ${fim.trad})`);
  ok(fim.temBotaoRef, 'oferece mandar as erradas para reforço');

  // ---------- a regra mais importante: NÃO mexe na agenda de revisão ----------
  const agenda = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antes = JSON.stringify(S.w);
    const diaAntes = JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom });
    startRelampago();
    SESSION.fase = 'jogando'; SESSION.fimEm = performance.now() + 30000;
    SESSION.proxima();
    for (let i = 0; i < 12; i++) SESSION.responder(i % 3 !== 0);
    SESSION.encerrar();
    return { igual: JSON.stringify(S.w) === antes,
             diaIgual: JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom }) === diaAntes,
             rel: today().rel };
  }, REAL);
  ok(agenda.igual, 'nenhum estágio, prazo ou contador de erro das palavras foi tocado');
  ok(agenda.diaIgual, 'não contou como palavra nova, revisão nem domínio no dia');
  ok(agenda.rel === 1, 'só marcou a rodada de relâmpago do dia');

  // o reforço é escolha dele, com um clique, e só nas que ele já estuda
  const reforco = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const estudadas = [];
    for (const i in S.w) if (S.w[i].l) estudadas.push(+i);
    const naoEstudada = [...Array(W.length).keys()].find(i => !isLearned(i));
    SESSION = new RelampagoSession([0]);
    SESSION.itens = [{ id: estudadas[0], dist: 1, dir: 'en', ok: false, ms: 900 },
                     { id: naoEstudada, dist: 2, dir: 'en', ok: false, ms: 900 }];
    SESSION.fase = 'fim'; SESSION.recordes = { antes: {} };
    SESSION.render(document.querySelector('#view'));
    const antesRef = !!S.w[estudadas[0]].r;
    document.querySelector('#relRef').click();
    return { antesRef, depois: !!S.w[estudadas[0]].r, naoCriou: !S.w[naoEstudada] || !S.w[naoEstudada].l };
  }, REAL);
  ok(!reforco.antesRef && reforco.depois, 'o botão marca para reforço a palavra que ele já estuda');
  ok(reforco.naoCriou, 'palavra que ele ainda não estudou não é forçada para dentro do estudo');

  // ---------- recordes ----------
  const rec = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel = { seq: 5, acertos: 9, tempo: 1200, rodadas: [], recentes: [] };
    SESSION = new RelampagoSession([0, 1, 2]);
    SESSION.acertos = 12; SESSION.melhorSeq = 7;
    SESSION.itens = Array.from({ length: 12 }, (_, i) => ({ id: i, dist: i + 1, dir: 'en', ok: true, ms: 800 }));
    SESSION.encerrar();
    const t = document.querySelector('#view').textContent;
    return { seq: S.rel.seq, acertos: S.rel.acertos, tempo: S.rel.tempo,
             medalhas: document.querySelectorAll('.rel-med').length, temTexto: /Novo recorde/.test(t),
             rodadas: S.rel.rodadas.length, recentes: S.rel.recentes.length };
  }, REAL);
  ok(rec.seq === 7 && rec.acertos === 12 && rec.tempo === 800, 'os três recordes são atualizados');
  ok(rec.medalhas === 3 && rec.temTexto, 'as três medalhas aparecem no relatório');
  ok(rec.rodadas === 1 && rec.recentes === 12, 'rodada entra no histórico e as palavras entram na lista de recentes');

  // recorde de tempo não cai com rodada curta (senão 2 acertos rápidos viram "recorde")
  const curta = await p.evaluate(() => {
    S.rel = { seq: 0, acertos: 0, tempo: 1000, rodadas: [], recentes: [] };
    SESSION = new RelampagoSession([0, 1]);
    SESSION.acertos = 3;
    SESSION.itens = [{ id: 0, dist: 1, dir: 'en', ok: true, ms: 200 }, { id: 2, dist: 3, dir: 'en', ok: true, ms: 200 }, { id: 4, dist: 5, dir: 'en', ok: true, ms: 200 }];
    SESSION.encerrar();
    return S.rel.tempo;
  });
  ok(curta === 1000, 'rodada com poucos acertos não vira recorde de tempo');

  // ---------- as palavras não repetem na rodada seguinte ----------
  const repete = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel.recentes = [];
    const a = relPool().slice(0, 12);
    S.rel.recentes = a.slice();
    const b = relPool().slice(0, 12);
    const repetidas = b.filter(i => a.indexOf(i) >= 0).length;
    return { repetidas, n: b.length };
  }, REAL);
  ok(repete.repetidas <= 6, `rodada seguinte evita repetir (${repete.repetidas} em comum, com base pequena)`);

  // ---------- persistência ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel = { seq: 9, acertos: 14, tempo: 870, rodadas: [[1700000000000, 14, 2, 9, 870]], recentes: [3, 7, 11] };
    today().rel = 2;
    const g = pack();
    const recTexto = g.rel.recentes;
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { chaveTexto: recTexto.every(k => /[a-z]/.test(k)),
             seq: v.rel.seq, acertos: v.rel.acertos, tempo: v.rel.tempo,
             rodadas: v.rel.rodadas.length, recentes: v.rel.recentes.join(),
             dia: v.dias[dayKey()].rel };
  }, REAL);
  ok(persist.chaveTexto, 'as palavras recentes são gravadas por texto, como o resto do sistema');
  ok(persist.seq === 9 && persist.acertos === 14 && persist.tempo === 870, 'recordes voltam do banco intactos');
  ok(persist.rodadas === 1 && persist.recentes === '3,7,11', 'histórico e lista de recentes voltam certos');
  ok(persist.dia === 2, 'o contador do dia volta certo');

  // e sobrevive a palavras novas no meio da lista
  const migra = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel.recentes = [3, 7, 11];
    const alvo = [W[3][2], W[7][2], W[11][2]];
    const g = pack();
    W.splice(2, 0, ['teste', 'TÉST', 'zzzrel1', 'pav', 'substantivo', 49]);
    for (const k in ixW) delete ixW[k];
    for (let i = 0; i < W.length; i++) ixW[String(W[i][2]).toLowerCase()] = i;
    const v = unpack(g);
    return { casa: v.rel.recentes.map(i => W[i][2]).join() === alvo.join(), idx: v.rel.recentes.join() };
  }, REAL);
  ok(migra.casa, 'depois de inserir palavra nova no meio, as recentes continuam apontando para as mesmas palavras (' + migra.idx + ')');

  // ---------- estado antigo, sem relâmpago nenhum ----------
  const antigo = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.rel;
    const v = normaliza(unpack(copia));
    return { rel: JSON.stringify(v.rel), dia: v.dias[Object.keys(v.dias)[0]].rel, pool: relPool().length };
  }, REAL);
  ok(antigo.rel === '{"seq":0,"acertos":0,"tempo":null,"rodadas":[],"recentes":[]}', 'estado salvo antes do relâmpago abre sem erro');
  ok(antigo.dia === 0 && antigo.pool > 0, 'dias antigos ganham o contador zerado e o jogo funciona');

  // ---------- Home e Progresso ----------
  const home = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel = { seq: 11, acertos: 0, tempo: null, rodadas: [], recentes: [] };
    go('home');
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { trilhas: document.querySelectorAll('.hoje .trilha').length, temTrilha: /Relâmpago/.test(t),
             recorde: /recorde 11 seguidas/.test(t), botao: !!document.querySelector('#aRel') };
  }, REAL);
  ok(home.trilhas === 6 && home.temTrilha, 'Relâmpago aparece como 6ª trilha do dia');
  ok(home.recorde, 'a trilha mostra o recorde dele');
  ok(home.botao, 'tem atalho direto no "Ir direto para"');

  const prox = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    // com tudo do estudo pendente, o jogo NÃO pode ser a próxima ação
    const comPendencia = nextAction().t;
    // zera as pendências do estudo
    for (const i in S.w) { S.w[i].n = Date.now() + 99 * 86400000; }
    for (const i in S.r) { S.r[i].n = Date.now() + 99 * 86400000; }
    for (const i in S.c) { S.c[i].n = Date.now() + 99 * 86400000; }
    const d = today();
    d.novas = 99; d.red = 99; d.chk = 99; d.txt = 99;
    S.txt = (S.txt || []).map(t => ({ ...t, lido: true }));
    const depois = nextAction();
    return { comPendencia, t: depois.t, txt: depois.txt, sub: depois.sub };
  }, REAL);
  ok(prox.comPendencia !== 'rel', `com estudo pendente a próxima ação continua sendo "${prox.comPendencia}", não o jogo`);
  ok(prox.t === 'rel' && /Relâmpago/.test(prox.txt), 'com o estudo em dia, o jogo entra como próxima ação');

  const prog = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rel = { seq: 11, acertos: 18, tempo: 700,
      rodadas: [[1, 8, 4, 3, 1500], [2, 9, 3, 4, 1400], [3, 10, 2, 5, 1300], [4, 12, 2, 6, 1000], [5, 13, 1, 7, 900], [6, 14, 1, 8, 800]],
      recentes: [] };
    go('prog');
    return document.querySelector('#view').textContent.replace(/\s+/g, ' ');
  }, REAL);
  ok(/Relâmpago/.test(prog) && /recorde de sequência/.test(prog), 'Progresso ganha o cartão do Relâmpago');
  ok(/mais rápido/.test(prog), 'o cartão mostra quanto o tempo de reconhecimento caiu: ' +
    (prog.match(/reconhece as palavras \d+% mais rápido/) || [''])[0]);

  // ---------- o cronômetro morre junto com a sessão ----------
  const limpa = await p.evaluate(async doc => {
    S = normaliza(unpack(doc));
    startRelampago(); SESSION.jogar();
    const s = SESSION;
    go('home');                       // sai no meio
    await new Promise(r => setTimeout(r, 250));
    return { parado: s.timer === null || SESSION !== s, semSessao: SESSION === null };
  }, REAL);
  ok(limpa.semSessao && limpa.parado, 'sair no meio da rodada não deixa cronômetro rodando atrás');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
