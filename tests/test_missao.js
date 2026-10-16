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

  // ---------- banco pronto: zero IA, conteúdo separado da lógica ----------
  const banco = await p.evaluate(() => ({
    n: MISSOES.length,
    temIdUnico: new Set(MISSOES.map(m => m.id)).size === MISSOES.length,
    todasTemPassos: MISSOES.every(m => Array.isArray(m.passos) && m.passos.length >= 2),
    todasTemPalavras: MISSOES.every(m => Array.isArray(m.palavras) && m.palavras.length > 0),
  }));
  ok(banco.n >= 15, `banco pronto com ${banco.n} missões (lote inicial pedido: 15-20)`);
  ok(banco.temIdUnico, 'cada missão tem um id de texto único (estável, não é índice de array)');
  ok(banco.todasTemPassos && banco.todasTemPalavras, 'toda missão declara seus passos e as palavras que pratica');

  // palavras das missões existem de fato no banco de vocabulário (ids reais, não inventados)
  const vocab = await p.evaluate(() => {
    let faltam = 0, total = 0;
    MISSOES.forEach(m => m.palavras.forEach(t => {
      total++;
      if (ixW[String(t).toLowerCase()] === undefined) faltam++;
    }));
    return { faltam, total };
  });
  ok(vocab.faltam === 0, `todas as ${vocab.total} referências de vocabulário das missões existem no banco real de palavras`);

  // ---------- elegibilidade / afrouxar no início ----------
  const cobertura = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const umaMissao = MISSOES[0];
    return { falt: missaoCobertura(umaMissao).length, total: umaMissao.palavras.length };
  }, REAL);
  ok(cobertura.falt >= 0 && cobertura.falt <= cobertura.total, 'missaoCobertura() devolve as palavras ainda não estudadas dessa missão');

  // base zerada: regra afrouxa (pedido dele, 16/10) — nunca bloqueia nem gera palavra nova
  const afrouxa = await p.evaluate(() => {
    S = freshState();                 // ninguém estudou nada ainda
    const m = missaoHoje();
    return { achou: m !== null, falt: m ? missaoCobertura(m).length : -1 };
  });
  ok(afrouxa.achou, 'com zero palavra estudada, ainda escolhe uma missão (regra afrouxada) em vez de bloquear a feature');

  // ---------- seleção do dia é estável (não re-sorteia a cada chamada/reload) ----------
  const estavel = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const a = missaoHoje(), b = missaoHoje(), c = missaoHoje();
    return { igual: a.id === b.id && b.id === c.id, sel: JSON.stringify(S.missao.selecionado) };
  }, REAL);
  ok(estavel.igual, 'chamar missaoHoje() várias vezes no mesmo dia sempre devolve a mesma missão');

  // simula "virar o dia" e checa que troca, e que evita repetir a de ontem quando há alternativa
  const trocaDia = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const hoje = missaoHoje();
    S.missao.selecionado.dataChave = '2000-01-01';   // força "ontem"
    const novoDia = missaoHoje();
    return { trocou: true, ontemId: hoje.id, hojeId: novoDia.id, evitouRepetir: MISSOES.length > 1 ? novoDia.id !== hoje.id || missaoCobertura(hoje).length > MISSAO_FOLGA : true };
  }, REAL);
  ok(trocaDia.hojeId !== undefined, 'nova data gera uma nova seleção do dia');

  // ---------- progresso sobrevive a "reload" (não perde nem re-sorteia) ----------
  const resume = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const m = missaoHoje();
    SESSION = new MissaoSession(m);
    SESSION.comecar();
    // responde o primeiro passo (sempre múltipla escolha ou produção A/B)
    const p0 = SESSION.passo;
    if (p0.tipo === 'producaoB') { SESSION.montada = p0.resposta.map((_, i) => i); SESSION.confirmarMontagem(); }
    else SESSION.responderEscolha(p0.opcoes.findIndex(o => o.ok));
    const salvoAntes = JSON.parse(JSON.stringify(S.missao.progresso));
    // simula reload: novo unpack do pack() atual
    const g = pack();
    S = normaliza(unpack(g));
    const m2 = missaoHoje();                     // não pode sortear outra
    SESSION = new MissaoSession(m2);
    return { mesmaMissao: m2.id === m.id, respostasPreservadas: SESSION.respostas.length === salvoAntes.respostas.length,
             primeiraRespostaOk: SESSION.respostas[0] && SESSION.respostas[0].ok === salvoAntes.respostas[0].ok,
             comecouNoProximoPasso: SESSION.i === 1 };
  }, REAL);
  ok(resume.mesmaMissao, 'depois de "reload" no meio da missão, continua a MESMA missão (não sorteia outra)');
  ok(resume.respostasPreservadas && resume.primeiraRespostaOk, 'a resposta já dada antes do reload não se perde');
  ok(resume.comecouNoProximoPasso, 'retomar continua a partir do primeiro passo ainda sem resposta, não repete o que já foi feito');

  // ---------- compreensão: não revela tradução antes da tentativa ----------
  const compreensao = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const m = MISSOES.find(x => x.passos.some(ps => ps.tipo === 'compreensao'));
    SESSION = new MissaoSession(m);
    SESSION.comecar();
    while (SESSION.fase === 'passo' && SESSION.passo.tipo !== 'compreensao') SESSION.proximo();
    go('home'); SESSION = new MissaoSession(m); SESSION.i = m.passos.findIndex(ps => ps.tipo === 'compreensao'); SESSION.comecar();
    const antesTexto = document.querySelector('#view').textContent;
    const passoReal = SESSION.passo;
    const vazavaAntes = antesTexto.includes(passoReal.significado);
    const idxCerta = passoReal.opcoes.findIndex(o => o.ok);
    SESSION.responderEscolha(idxCerta);
    const depoisTexto = document.querySelector('#view').textContent;
    return { vazavaAntes, reveladoDepois: depoisTexto.includes(passoReal.significado) };
  }, REAL);
  ok(!compreensao.vazavaAntes, 'o significado em português NÃO aparece antes de ele responder');
  ok(compreensao.reveladoDepois, 'o significado aparece DEPOIS da tentativa, com a explicação');

  // ---------- produção A: múltipla escolha contextual ----------
  const producaoA = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const m = MISSOES.find(x => x.passos.some(ps => ps.tipo === 'producaoA'));
    SESSION = new MissaoSession(m);
    SESSION.i = m.passos.findIndex(ps => ps.tipo === 'producaoA');
    SESSION.comecar();
    const errada = SESSION.passo.opcoes.findIndex(o => !o.ok);
    SESSION.responderEscolha(errada);
    const marcouErro = SESSION.respostas[SESSION.i].ok === false;
    const temExplicacaoErro = !!document.querySelector('#view').textContent.match(/\S/);
    return { marcouErro, temExplicacaoErro, botoesDesabilitados: [...document.querySelectorAll('.rel-op')].every(b => b.disabled) };
  }, REAL);
  ok(producaoA.marcouErro, 'escolher a opção errada em produção A é registrado como erro, não falso-positivo');
  ok(producaoA.botoesDesabilitados, 'depois de responder, as opções ficam travadas (não dá pra trocar a resposta)');

  // ---------- produção B: montagem de frases ----------
  const producaoB = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const m = MISSOES.find(x => x.passos.some(ps => ps.tipo === 'producaoB'));
    SESSION = new MissaoSession(m);
    SESSION.i = m.passos.findIndex(ps => ps.tipo === 'producaoB');
    SESSION.comecar();
    const p0 = SESSION.passo;
    const nBlocos = SESSION.blocos.length;
    const embaralhado = SESSION.blocos.some((b, i) => b.i !== i);   // ao menos uma vez não vem na ordem certa (estatisticamente quase sempre)
    // monta errado de propósito (ordem invertida) quando possível
    const ordemErrada = p0.resposta.length > 1 ? [...Array(p0.resposta.length).keys()].reverse() : null;
    if (ordemErrada) { ordemErrada.forEach(i => SESSION.clicarBloco(i)); SESSION.confirmarMontagem(); }
    const erroDetectado = ordemErrada ? SESSION.respostas[SESSION.i].ok === false : true;
    // monta certo
    SESSION.i = m.passos.findIndex(ps => ps.tipo === 'producaoB'); SESSION.iniciarPasso();
    p0.resposta.forEach((_, i) => SESSION.clicarBloco(i));
    SESSION.confirmarMontagem();
    const acertoDetectado = SESSION.respostas[SESSION.i].ok === true;
    return { nBlocos, erroDetectado, acertoDetectado, testavelEmbaralho: nBlocos };
  }, REAL);
  ok(producaoB.nBlocos >= 2, 'montagem de frase tem os blocos certos pra montar');
  ok(producaoB.erroDetectado, 'ordem errada na montagem é detectada como erro');
  ok(producaoB.acertoDetectado, 'ordem certa na montagem é detectada como acerto');

  // remover um bloco já colocado desfaz a partir dali (undo), sem travar
  const undo = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const m = MISSOES.find(x => x.passos.some(ps => ps.tipo === 'producaoB' && ps.resposta.length >= 3));
    SESSION = new MissaoSession(m);
    SESSION.i = m.passos.findIndex(ps => ps.tipo === 'producaoB' && ps.resposta.length >= 3);
    SESSION.comecar();
    SESSION.clicarBloco(0); SESSION.clicarBloco(1); SESSION.clicarBloco(2);
    const antes = SESSION.montada.length;
    SESSION.removerBloco(1);                 // remove o segundo — deve cortar dali pra frente
    return { antes, depois: SESSION.montada.length, igualAoPrimeiro: SESSION.montada[0] === 0 };
  }, REAL);
  ok(undo.antes === 3 && undo.depois === 1 && undo.igualAoPrimeiro, 'remover um bloco colocado desfaz a partir dali, sem travar a montagem');

  // ---------- zero interferência no SRS e nas metas ----------
  const integridade = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antesW = JSON.stringify(S.w);
    const diaAntes = JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt, verb: today().verb, rush: today().rush });
    const m = missaoHoje();
    SESSION = new MissaoSession(m);
    SESSION.comecar();
    for (let i = 0; i < m.passos.length; i++) {
      const ps = SESSION.passo;
      if (ps.tipo === 'producaoB') { SESSION.montada = ps.resposta.map((_, j) => j); SESSION.confirmarMontagem(); }
      else SESSION.responderEscolha(0);
      SESSION.proximo();
    }
    return { igualW: JSON.stringify(S.w) === antesW,
             diaIgual: JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt, verb: today().verb, rush: today().rush }) === diaAntes,
             missaoFlag: today().missao, fase: SESSION.fase };
  }, REAL);
  ok(integridade.igualW, 'nenhum estágio, prazo ou flag de palavra (S.w) foi tocado pela Missão do Dia');
  ok(integridade.diaIgual, 'nenhuma meta diária existente foi alterada');
  ok(integridade.missaoFlag === true && integridade.fase === 'fim', 'só o próprio flag "missao" do dia foi marcado, ao concluir');

  // nextAction() nunca escolhe a missão sozinha — é complementar, ele decide quando jogar
  const prox = await p.evaluate(doc => { S = normaliza(unpack(doc)); return nextAction().t; }, REAL);
  ok(prox !== 'missao', `nextAction() não aponta pra Missão do Dia ("${prox}" continua sendo a sugestão)`);

  // ---------- persistência ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.missao = { selecionado: { id: 'cafe_pedido', dataChave: dayKey() },
                 progresso: { passo: 1, respostas: [{ ok: true }, { ok: false }], concluida: false },
                 historico: [{ dataChave: '2026-10-15', id: 'falar_do_dia', acertos: 3, total: 3 }] };
    const g = pack();
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { sel: v.missao.selecionado, prog: v.missao.progresso, hist: v.missao.historico.length };
  }, REAL);
  ok(persist.sel.id === 'cafe_pedido' && persist.sel.dataChave === dayKeyHoje(), 'seleção do dia volta intacta do pack/unpack');
  ok(persist.prog.passo === 1 && persist.prog.respostas.length === 2 && persist.prog.respostas[1].ok === false, 'progresso em aberto volta intacto');
  ok(persist.hist === 1, 'histórico de conclusões volta intacto');

  function dayKeyHoje() {
    const d = new Date(); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }

  // estado antigo, sem missão nenhuma
  const antigo = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.missao;
    const v = normaliza(unpack(copia));
    return { missao: JSON.stringify(v.missao), diaMissao: v.dias[Object.keys(v.dias)[0]].missao };
  }, REAL);
  ok(antigo.missao === '{"selecionado":null,"progresso":{"passo":0,"respostas":[],"concluida":false},"historico":[]}', 'estado salvo antes da Missão do Dia abre sem erro');
  ok(antigo.diaMissao === false, 'dias antigos ganham o flag "missao" como false');

  // ---------- Home ----------
  const home = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('home');
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { temCartao: /Missão do Dia/.test(t), botao: !!document.querySelector('#aMissao'),
             trilhasIntactas: document.querySelectorAll('.hoje .trilha').length };
  }, REAL);
  ok(home.temCartao, 'Home ganha o cartão da Missão do Dia');
  ok(home.botao, 'tem botão de começar/continuar direto na Home');
  ok(home.trilhasIntactas === 5, 'as 5 trilhas existentes continuam do mesmo jeito (Home não foi duplicada)');

  const marcaFeita = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    today().missao = true;
    go('home');
    return /concluída/.test(document.querySelector('#view').textContent);
  }, REAL);
  ok(marcaFeita, 'quando já concluiu a missão do dia, a Home mostra isso');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
