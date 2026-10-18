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

  // ---------- bancos prontos: zero IA, conteúdo separado da lógica ----------
  const bancos = await p.evaluate(() => ({
    lab: { n: LAB.length, idUnico: new Set(LAB.map(x => x.id)).size === LAB.length,
           blocosFecham: LAB.every(x => x.blocos.join(' ') === x.frase) },
    det: { n: DETECTIVE.length, idUnico: new Set(DETECTIVE.map(x => x.id)).size === DETECTIVE.length },
    msw: { n: MEANING.length, idUnico: new Set(MEANING.map(x => x.palavra)).size === MEANING.length,
           desafios: MEANING.reduce((s, w) => s + (w.desafios || []).length, 0) },
    story: { n: STORIES.length, cenasOk: STORIES.every(s => Array.isArray(s.cenas) && s.cenas.length >= 4 && s.cenas.length <= 6) },
    surv: { n: SURVIVAL.length, temGrafo: SURVIVAL.every(m => m.passos && !Array.isArray(m.passos) && m.passoInicial in m.passos) },
  }));
  ok(bancos.lab.n >= 30 && bancos.lab.idUnico && bancos.lab.blocosFecham, `Frase Lab: ${bancos.lab.n} frases, ids únicos, blocos == frase`);
  ok(bancos.det.n >= 30 && bancos.det.idUnico, `English Detective: ${bancos.det.n} casos, ids únicos`);
  ok(bancos.msw.n >= 10 && bancos.msw.idUnico && bancos.msw.desafios >= 25, `Meaning Switch: ${bancos.msw.n} palavras, ${bancos.msw.desafios} desafios`);
  ok(bancos.story.n >= 5 && bancos.story.cenasOk, `Story Rebuild: ${bancos.story.n} histórias, cenas em faixa razoável`);
  ok(bancos.surv.n >= 5 && bancos.surv.temGrafo, `Survival Choices: ${bancos.surv.n} missões, passos em grafo (objeto, não array)`);

  // ---------- navegação ----------
  const nav = await p.evaluate(() => ({ temTab: TABS.some(([k]) => k === 'academia'), rotaExiste: typeof viewAcademia === 'function' }));
  ok(nav.temTab, '"academia" está em TABS');
  ok(nav.rotaExiste, 'viewAcademia existe e é chamável pelo render()');

  const tela = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('academia');
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { temAcademia: /Academia de Inglês/.test(t), n5cards: document.querySelectorAll('[data-modo]').length };
  }, REAL);
  ok(tela.temAcademia, 'tela "Academia de Inglês" renderiza');
  ok(tela.n5cards === 5, `tela mostra os 5 cards (achou ${tela.n5cards})`);

  // ---------- isolamento: nunca tocam SRS/Missão do Dia ----------
  const isolamento = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antesW = JSON.stringify(S.w), antesMissao = JSON.stringify(S.missao);
    const dia = JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom });

    SESSION = new LabSession(); SESSION.responderNivel1 ? null : null;
    if (SESSION.nivel === 1) SESSION.responderNivel1(0); else { SESSION.estado.montada = [0]; SESSION.confirmarMontagem(); }
    SESSION = new DetectiveSession();
    const c0 = SESSION.caso;
    if (c0.tarefa === 'escolher_certa') SESSION.responderEscolher(0);
    else if (c0.tarefa === 'selecionar_parte') SESSION.responderToken(0);
    else { SESSION.estado.montada = [0]; SESSION.confirmarMontagem(); }
    SESSION = new MeaningSession(); SESSION.responder(0);
    SESSION = new StoryRebuildSession(); SESSION.estado.montada = [0]; SESSION.confirmar();
    SESSION = new SurvivalSession(SURVIVAL[0]); SESSION.comecar();

    return {
      igualW: JSON.stringify(S.w) === antesW,
      igualMissao: JSON.stringify(S.missao) === antesMissao,
      diaIgual: JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom }) === dia,
    };
  }, REAL);
  ok(isolamento.igualW, 'nenhum dos 5 modos nunca tocou S.w (vocabulário/SRS)');
  ok(isolamento.igualMissao, 'nenhum dos 5 modos tocou S.missao (Missão do Dia)');
  ok(isolamento.diaIgual, 'metas diárias (novas/revs/dom) não foram alteradas pela Academia');

  // ---------- Frase Lab: 3 níveis, promove/mantém nível por acerto/erro ----------
  const lab = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const item = LAB[0];
    S.lab.itens[item.id] = { nivel: 1 };
    SESSION = new LabSession();
    SESSION.itens = [item]; SESSION.i = 0;
    SESSION.iniciarItem();
    const idxCerta = SESSION.opcoes.findIndex(t => t === item.frase);
    SESSION.responderNivel1(idxCerta);
    const subiuNivel = S.lab.itens[item.id].nivel === 2;

    S.lab.itens[item.id] = { nivel: 3 };
    SESSION = new LabSession();
    SESSION.itens = [item]; SESSION.i = 0;
    SESSION.iniciarItem();
    const ordemErrada = SESSION.pool.map((_, i) => i).reverse();
    ordemErrada.forEach(i => { if (SESSION.estado.montada.length < item.blocos.length) SESSION.estado.montada.push(i); });
    SESSION.confirmarMontagem();
    const erroDetectado = SESSION.certo === false;
    const manteveNivel = S.lab.itens[item.id].nivel === 3;
    return { subiuNivel, erroDetectado, manteveNivel };
  }, REAL);
  ok(lab.subiuNivel, 'Frase Lab: acertar nível 1 promove a frase pro nível 2');
  const quatro = await p.evaluate(doc => { S = normaliza(unpack(doc)); S.lab.itens[LAB[0].id] = { nivel: 1 }; SESSION = new LabSession(); SESSION.itens = [LAB[0]]; SESSION.i = 0; SESSION.iniciarItem();
    return { n: SESSION.opcoes.length, unicas: new Set(SESSION.opcoes).size, certa: SESSION.opcoes.includes(LAB[0].frase) }; }, REAL);
  ok(quatro.n === 4 && quatro.unicas === 4 && quatro.certa, 'Frase Lab nível 1 tem 4 alternativas (pedido dele, 17/10)');
  ok(lab.erroDetectado, 'Frase Lab: montagem fora de ordem no nível 3 é detectada como erro');
  ok(lab.manteveNivel, 'Frase Lab: errar não sobe de nível');

  // ---------- English Detective: 3 tipos de tarefa funcionam ----------
  const det = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const porTarefa = t => DETECTIVE.find(x => x.tarefa === t);
    const res = {};
    ['escolher_certa', 'selecionar_parte', 'montar_corrigida'].forEach(t => {
      const caso = porTarefa(t);
      if (!caso) { res[t] = 'sem_caso'; return; }
      SESSION = new DetectiveSession();
      SESSION.itens = [caso]; SESSION.i = 0;
      SESSION.iniciarCaso();
      if (t === 'escolher_certa') SESSION.responderEscolher(caso.opcoes.findIndex(o => o.ok));
      else if (t === 'selecionar_parte') SESSION.responderToken(caso.indice_erro);
      else {
        const usados = new Set();
        caso.resposta.forEach(tok => {
          const idx = SESSION.pool.findIndex((t2, i) => t2 === tok && !usados.has(i));
          if (idx >= 0) { SESSION.estado.montada.push(idx); usados.add(idx); }
        });
        SESSION.confirmarMontagem();
      }
      res[t] = SESSION.certo;
    });
    return res;
  }, REAL);
  ok(det.escolher_certa === true, 'English Detective: escolher a opção certa marca acerto');
  ok(det.selecionar_parte === true, 'English Detective: apontar o índice certo do erro marca acerto');
  ok(det.montar_corrigida === true || det.montar_corrigida === 'sem_caso', 'English Detective: montar a correção na ordem certa marca acerto');

  // ---------- Meaning Switch: escolha certa x errada ----------
  const msw = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    SESSION = new MeaningSession();
    const d = SESSION.itens[0];
    const certa = d.opcoes.findIndex(o => o.ok);
    const errada = d.opcoes.findIndex(o => !o.ok);
    SESSION.responder(certa);
    const acertou = SESSION.certo === true;
    SESSION = new MeaningSession();
    SESSION.itens = [d]; SESSION.i = 0; SESSION.revelado = false; SESSION.escolhaIdx = null;
    SESSION.responder(errada >= 0 ? errada : certa);
    const marcouErroQuandoCabivel = errada >= 0 ? SESSION.certo === false : true;
    return { acertou, marcouErroQuandoCabivel };
  }, REAL);
  ok(msw.acertou, 'Meaning Switch: escolher a opção certa marca acerto');
  ok(msw.marcouErroQuandoCabivel, 'Meaning Switch: escolher a opção errada marca erro');

  // ---------- Story Rebuild: ordem certa x errada ----------
  const story = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    SESSION = new StoryRebuildSession();
    const resp = SESSION.story.cenas.map(c => c.en);
    SESSION.estado.montada = resp.map(t => SESSION.pool.indexOf(t));
    SESSION.confirmar();
    const certoNaOrdem = SESSION.certo === true;
    const concluidaMarcada = S.story.itens[SESSION.story.id].concluida === true;

    S = normaliza(unpack(doc));
    SESSION = new StoryRebuildSession();
    const respErrada = SESSION.story.cenas.map(c => c.en);
    const tmp = respErrada[0]; respErrada[0] = respErrada[1]; respErrada[1] = tmp; // troca as 2 primeiras cenas de lugar
    const usadosE = new Set();
    SESSION.estado.montada = respErrada.map(t => {
      const idx = SESSION.pool.findIndex((t2, i) => t2 === t && !usadosE.has(i));
      usadosE.add(idx); return idx;
    });
    SESSION.confirmar();
    const erroDetectado = SESSION.pool.length > 1 ? SESSION.certo === false : true;
    return { certoNaOrdem, concluidaMarcada, erroDetectado };
  }, REAL);
  ok(story.certoNaOrdem, 'Story Rebuild: reconstruir na ordem certa marca acerto');
  ok(story.concluidaMarcada, 'Story Rebuild: concluir marca a história como feita no estado');
  ok(story.erroDetectado, 'Story Rebuild: ordem errada é detectada');

  // ---------- Survival Choices: grafo com ramificação real + progresso sobrevive a reload ----------
  const surv = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const missao = SURVIVAL.find(m => Object.values(m.passos).some(ps => ps.tipo === 'intencao' && new Set(ps.opcoes.map(o => o.proximo)).size >= 2)) || SURVIVAL[0];
    SESSION = new SurvivalSession(missao);
    SESSION.comecar();
    const p0 = SESSION.passo;
    let destino1 = null, destino2 = null;
    if (p0.tipo === 'intencao' && p0.opcoes.length >= 2) {
      destino1 = p0.opcoes[0].proximo; destino2 = p0.opcoes.find(o => o.proximo !== destino1);
    }
    const ramificaDeVerdade = !!(destino2 && destino2.proximo !== destino1);

    // avança um passo e simula "reload": progresso em aberto deve sobreviver
    SESSION.responderOpcao ? (p0.tipo === 'intencao' || p0.tipo === 'compreensao' ? SESSION.responderOpcao(0) : null) : null;
    if (p0.tipo === 'intencao') SESSION.irPara(p0.opcoes[0].proximo);
    else if (p0.tipo === 'producaoB') { SESSION.estado.montada = p0.resposta.map(t => SESSION.pool.indexOf(t)); SESSION.confirmarMontagem(); SESSION.irPara(p0.proximo); }
    const passoAposAvancar = SESSION.passoId;
    const g = pack();
    S = normaliza(unpack(JSON.parse(JSON.stringify(g))));
    const retomado = S.surv.itens[missao.id] && S.surv.itens[missao.id].progressoAberto && S.surv.itens[missao.id].progressoAberto.passoId === passoAposAvancar;

    return { temIntencao: p0.tipo !== undefined, ramificaDeVerdade, retomado: !!retomado };
  }, REAL);
  ok(surv.ramificaDeVerdade, 'Survival Choices: ao menos uma missão tem passo "intencao" com 2 destinos (proximo) diferentes de verdade');
  ok(surv.retomado, 'Survival Choices: progresso em aberto (passoId) sobrevive ao pack/unpack ("reload")');

  // ---------- persistência: pack/unpack preserva os 5 campos novos ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.lab.itens['x1'] = { nivel: 2 };
    S.det.itens['x2'] = { acertos: 3, erros: 1 };
    S.msw.itens['x3'] = { acertos: 1, erros: 0 };
    S.story.itens['x4'] = { concluida: true };
    S.surv.itens['x5'] = { concluida: true, fins: ['fimA'] };
    const g = pack();
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return {
      lab: v.lab.itens.x1.nivel === 2,
      det: v.det.itens.x2.acertos === 3 && v.det.itens.x2.erros === 1,
      msw: v.msw.itens.x3.acertos === 1,
      story: v.story.itens.x4.concluida === true,
      surv: v.surv.itens.x5.concluida === true && v.surv.itens.x5.fins[0] === 'fimA',
    };
  }, REAL);
  ok(persist.lab && persist.det && persist.msw && persist.story && persist.surv, 'pack/unpack preserva os 5 campos novos (lab/det/msw/story/surv) intactos');

  // estado antigo, sem nenhum dos 5 campos
  const antigo = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.lab; delete copia.det; delete copia.msw; delete copia.story; delete copia.surv;
    const v = unpack(copia);
    return { ok: ['lab', 'det', 'msw', 'story', 'surv'].every(k => v[k] && typeof v[k].itens === 'object' && Array.isArray(v[k].hist)) };
  }, REAL);
  ok(antigo.ok, 'estado salvo antes da Academia abre sem erro (os 5 campos nascem zerados)');

  // ---------- SESSION.key não quebra o atalho global de teclado ----------
  const teclado = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const classes = [LabSession, DetectiveSession, MeaningSession, StoryRebuildSession, SurvivalSession];
    return classes.every(C => typeof C.prototype.key === 'function');
  }, REAL);
  ok(teclado, 'as 5 classes de sessão implementam .key(e), mesmo que vazio (atalho global não quebra)');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
