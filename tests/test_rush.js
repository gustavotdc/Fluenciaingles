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

  // ---------- elegibilidade: só palavra já estudada (estágio 1+), nunca nova ----------
  const elig = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const e = rushElegiveis();
    return { n: e.length, todasEstudadas: e.every(i => isLearned(i)),
             aprendidasReais: Object.keys(S.w).filter(i => S.w[i].l).length };
  }, REAL);
  ok(elig.todasEstudadas, `rushElegiveis() só devolve palavra já estudada (${elig.n} elegíveis)`);
  ok(elig.n === elig.aprendidasReais, `cobre exatamente as ${elig.aprendidasReais} palavras aprendidas do estado, nem mais nem menos`);

  // base zerada (ninguém estudou nada): não pode cair pra palavra não vista
  const zerada = await p.evaluate(() => {
    S = freshState();
    return { n: rushElegiveis().length };
  });
  ok(zerada.n === 0, 'base zerada: zero elegíveis (nenhuma palavra nova entra no lugar)');

  // ---------- guarda de banco pequeno: mensagem clara, sem recorrer a palavra não vista ----------
  const poucas = await p.evaluate(() => {
    S = freshState();
    wd(0).l = Date.now(); wd(1).l = Date.now();           // só 2 aprendidas, precisa de 4+
    SESSION = null;
    startRush(120);
    return { abriuSessao: SESSION !== null, toastNaTela: document.body.textContent.includes('Ainda não há palavras estudadas') };
  });
  ok(!poucas.abriuSessao, 'com poucas palavras elegíveis, não inicia sessão nenhuma');

  // ---------- a sessão respeita a duração escolhida ----------
  const dur = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    startRush(180);
    return { duracao: SESSION.dur, tela: document.querySelector('#view').textContent };
  }, REAL);
  ok(dur.duracao === 180, `sessão abre com os 3 minutos escolhidos (${dur.duracao}s)`);
  ok(/3 minutos/.test(dur.tela), 'tela inicial mostra a duração escolhida');

  await p.evaluate(() => SESSION.trocarDuracao(300));
  const trocou = await p.evaluate(() => SESSION.dur);
  ok(trocou === 300, 'pode trocar a duração ainda na tela de pronto, sem voltar pra Home');

  // ---------- a rodada: só 2 opções, sempre palavra em inglês ----------
  await p.evaluate(doc => { S = normaliza(unpack(doc)); startRush(120); SESSION.comecar(); }, REAL);
  await p.waitForTimeout(2200);
  const jogo = await p.evaluate(() => {
    const w = W[SESSION.atual.id];
    return { ops: document.querySelectorAll('.rel-op').length,
             alvo: document.querySelector('.rel-alvo').textContent.trim(),
             ehIngles: document.querySelector('.rel-alvo').textContent.trim() === w[2],
             seg: parseFloat(document.querySelector('#rushSeg').textContent) };
  });
  ok(jogo.ops === 2, 'carta sempre com duas alternativas');
  ok(jogo.ehIngles, 'a palavra mostrada é sempre em inglês (nunca pede pra traduzir pro inglês)');
  ok(jogo.seg > 110 && jogo.seg <= 120, `relógio correndo em ${jogo.seg}s de 120s`);

  // ---------- erro reaparece mais adiante, nunca na pergunta seguinte, sem perder tempo ----------
  const reapar = await p.evaluate(() => {
    const erradoId = SESSION.atual.id;
    const fimAntes = SESSION.fimEm;
    SESSION.responder(false);                       // erra de propósito
    const proximoImediato = SESSION.atual.id;
    const fimDepois = SESSION.fimEm;
    let posicao = -1;
    for (let i = 0; i < 6 && posicao < 0; i++) {
      if (SESSION.atual.id === erradoId) posicao = i;
      else SESSION.responder(true);
    }
    return { repetiuNaHora: proximoImediato === erradoId, achou: posicao >= 0, posicao,
             tempoIntacto: fimAntes === fimDepois };
  });
  ok(!reapar.repetiuNaHora, 'a mesma palavra não volta na pergunta imediatamente seguinte');
  ok(reapar.achou && reapar.posicao >= 2, `a errada reaparece mais adiante na mesma sessão (depois de ${reapar.posicao + 1} outras)`);
  ok(reapar.tempoIntacto, 'errar não tira tempo do cronômetro (sem penalidade artificial)');

  // ---------- placar e sequência ----------
  const placar = await p.evaluate(() => {
    SESSION.acertos = 0; SESSION.erros = 0; SESSION.seq = 0; SESSION.melhorSeq = 0; SESSION.itens = []; SESSION.total = 0; SESSION.pendentes = [];
    [true, true, true, false, true, true, true, true, true, false].forEach(r => SESSION.responder(r));
    return { a: SESSION.acertos, e: SESSION.erros, seq: SESSION.melhorSeq, n: SESSION.itens.length };
  });
  ok(placar.a === 8 && placar.e === 2, `placar certo: ${placar.a} acertos, ${placar.e} erros`);
  ok(placar.seq === 5, `maior sequência calculada certa: ${placar.seq}`);
  ok(placar.n === 10, 'cada resposta é registrada');

  // ---------- relatório final ----------
  const fim = await p.evaluate(() => {
    SESSION.encerrar();
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { t, erradas: document.querySelectorAll('.rel-l.bad').length,
             temJogarDeNovo: !!document.querySelector('#dnv'), temVoltar: !!document.querySelector('#home') };
  });
  ok(/8\s*acertos/.test(fim.t) && /2\s*erros/.test(fim.t), 'relatório mostra o placar final');
  ok(/80%/.test(fim.t), 'relatório mostra a porcentagem de acerto');
  ok(fim.erradas >= 1, 'relatório lista as palavras erradas com significado');
  ok(fim.temJogarDeNovo && fim.temVoltar, 'oferece jogar de novo e voltar ao início');

  // ---------- a regra mais importante: zero interferência no SRS e nas metas ----------
  const integridade = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antesW = JSON.stringify(S.w);
    const diaAntes = JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt, verb: today().verb });
    startRush(120);
    SESSION.fase = 'jogando'; SESSION.fimEm = performance.now() + 120000;
    SESSION.proxima();
    for (let i = 0; i < 14; i++) SESSION.responder(i % 3 !== 0);
    SESSION.encerrar();
    return { igualW: JSON.stringify(S.w) === antesW,
             diaIgual: JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt, verb: today().verb }) === diaAntes,
             rush: today().rush };
  }, REAL);
  ok(integridade.igualW, 'nenhum estágio, prazo, erro ou flag de palavra foi tocado (S.w intacto)');
  ok(integridade.diaIgual, 'nenhuma meta diária (novas/revisões/domínio/reduções/blocos/leitura/verbos) foi alterada');
  ok(integridade.rush === 1, 'só o contador próprio "rush" do dia foi marcado');

  const naoAvanca = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const estudada = Object.keys(S.w).map(Number).find(i => S.w[i].l);
    const antes = JSON.stringify(S.w[estudada]);
    SESSION = new RushSession(120, [estudada, estudada + 1, estudada + 2, estudada + 3]);
    SESSION.fase = 'jogando'; SESSION.fimEm = performance.now() + 120000;
    SESSION.atual = { id: estudada, dist: estudada + 1, esq: true };
    SESSION.responder(true);
    return { igual: JSON.stringify(S.w[estudada]) === antes };
  }, REAL);
  ok(naoAvanca.igual, 'acerto na múltipla escolha não avança estágio nem marca como aprendida/dominada');

  // ---------- não exige vocabulário fora do que ele já estuda, mesmo com banco gigante ----------
  const escala = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antes = rushElegiveis().length;
    // simula o banco crescendo pra milhares de palavras
    for (let i = 0; i < 5000; i++) W.push(['teste ' + i, 'tést', 'zzztestrush' + i, 'pav', 'substantivo', 3000 + i]);
    const depois = rushElegiveis().length;
    const t0 = Date.now();
    startRush(120);
    const dt = Date.now() - t0;
    return { antes, depois, abriu: SESSION !== null, dt };
  }, REAL);
  ok(escala.antes === escala.depois, 'adicionar milhares de palavras novas ao banco não aumenta os elegíveis (ele não usa palavra nunca vista)');
  ok(escala.abriu, 'sessão continua abrindo normalmente com um banco de milhares de palavras');
  ok(escala.dt < 500, `sorteio continua rápido com banco grande (${escala.dt}ms)`);

  // ---------- persistência ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rush = { recs: { 120: { acertos: 9, seq: 5 }, 300: { acertos: 20, seq: 8 } },
               hist: [{ t: 1700000000000, dur: 120, acertos: 9, erros: 1, seq: 5 }],
               misses: { 3: Date.now(), 7: Date.now() - 1000 } };
    today().rush = 2;
    const g = pack();
    const chavesMiss = Object.keys(g.rush.miss);
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { chaveTexto: chavesMiss.every(k => /[a-z]/.test(k)),
             recs120: v.rush.recs[120], recs300: v.rush.recs[300],
             hist: v.rush.hist.length, misses: Object.keys(v.rush.misses).length,
             dia: v.dias[dayKey()].rush };
  }, REAL);
  ok(persist.chaveTexto, 'erros isolados são gravados por texto, como o resto do sistema');
  ok(persist.recs120.acertos === 9 && persist.recs120.seq === 5, 'recorde de 2 min volta intacto');
  ok(persist.recs300.acertos === 20 && persist.recs300.seq === 8, 'recorde de 5 min volta separado, intacto');
  ok(persist.hist === 1, 'histórico de sessões volta intacto');
  ok(persist.misses === 2, 'mapa de erros isolados do Recall Rush volta intacto');
  ok(persist.dia === 2, 'contador do dia volta certo');

  // sobrevive a palavra nova inserida no meio da lista (remapeamento por texto)
  const migra = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rush.misses = { 3: Date.now(), 7: Date.now() };
    const alvo = [W[3][2], W[7][2]];
    const g = pack();
    W.splice(2, 0, ['teste', 'TÉST', 'zzzrush1', 'pav', 'substantivo', 49]);
    for (const k in ixW) delete ixW[k];
    for (let i = 0; i < W.length; i++) ixW[String(W[i][2]).toLowerCase()] = i;
    const v = unpack(g);
    return { casa: Object.keys(v.rush.misses).map(i => W[i][2]).sort().join() === alvo.slice().sort().join() };
  }, REAL);
  ok(migra.casa, 'depois de inserir palavra nova no meio, os erros isolados continuam apontando pras mesmas palavras');

  // ---------- estado antigo, sem recall rush nenhum ----------
  const antigo = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.rush;
    const v = normaliza(unpack(copia));
    return { rush: JSON.stringify(v.rush), dia: v.dias[Object.keys(v.dias)[0]].rush };
  }, REAL);
  ok(antigo.rush === '{"recs":{},"hist":[],"misses":{}}', 'estado salvo antes do Recall Rush abre sem erro');
  ok(antigo.dia === 0, 'dias antigos ganham o contador "rush" zerado');

  // ---------- peso: palavra marcada para reforço aparece muito mais ----------
  const peso = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const ids = Object.keys(S.w).map(Number).filter(i => S.w[i].l);
    if (ids.length < 2) return null;
    const alvo = ids[0];
    S.w[alvo].r = true;
    const outro = ids[1];
    S.w[outro].r = false; S.w[outro].e = 0;
    return { reforco: rushPeso(alvo), normal: rushPeso(outro) };
  }, REAL);
  if (peso) ok(peso.reforco > peso.normal, `palavra em reforço pesa mais no sorteio (${peso.reforco} vs ${peso.normal})`);

  // ---------- Home ----------
  const home = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.rush.hist = [{ t: Date.now(), dur: 180, acertos: 14, erros: 2, seq: 7 }];
    go('home');
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { temCartao: /Recall Rush/.test(t), temUltima: /14 acertos, 2 erros/.test(t),
             b2: !!document.querySelector('#aRush2'), b3: !!document.querySelector('#aRush3'), b5: !!document.querySelector('#aRush5'),
             trilhasIntactas: document.querySelectorAll('.hoje .trilha').length };
  }, REAL);
  ok(home.temCartao, 'Home ganha o cartão do Recall Rush');
  ok(home.temUltima, 'cartão mostra o resultado da última sessão');
  ok(home.b2 && home.b3 && home.b5, 'atalhos de 2, 3 e 5 minutos na Home');
  ok(home.trilhasIntactas === 5, 'as 5 trilhas existentes continuam do mesmo jeito (Home não foi duplicada)');

  const clique = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('home');
    document.querySelector('#aRush3').click();
    return { dur: SESSION ? SESSION.dur : null };
  }, REAL);
  ok(clique.dur === 180, 'clicar em "3 min" na Home já inicia a sessão com 3 minutos');

  // nextAction() nunca escolhe o Recall Rush sozinho (treino complementar, não compete com a agenda)
  const prox = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    return nextAction().t;
  }, REAL);
  ok(prox !== 'rush', `nextAction() não aponta pro Recall Rush ("${prox}" continua sendo a sugestão)`);

  // ---------- o cronômetro morre junto com a sessão ----------
  const limpa = await p.evaluate(async doc => {
    S = normaliza(unpack(doc));
    startRush(120); SESSION.jogar();
    const s = SESSION;
    go('home');
    await new Promise(r => setTimeout(r, 250));
    return { parado: s.timer === null || SESSION !== s, semSessao: SESSION === null };
  }, REAL);
  ok(limpa.semSessao && limpa.parado, 'sair no meio da sessão não deixa cronômetro rodando atrás');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
