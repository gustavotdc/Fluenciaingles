// 17/10: trocar etiqueta da palavra + verbo do dia com revisões espaçadas.
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  let falhas = 0; const errs = [];
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto(APP); await p.waitForTimeout(400);
  const fresh = () => p.evaluate(doc => { S = normaliza(unpack(doc)); go('home'); }, REAL);
  await fresh();

  // ================= ETIQUETA DA PALAVRA =================
  // pega uma palavra ainda nova (a "I" do exemplo dele é a mais comum; aqui qualquer nova serve)
  const alvo = await p.evaluate(() => { for (let i = 0; i < W.length; i++) if (statusOf(i) === 'nova') return i; return -1; });
  ok(alvo >= 0, 'existe palavra nova para testar (' + alvo + ')');
  await p.evaluate(() => { go('bank'); });
  await p.evaluate(i => openWord(i), alvo);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.modal [data-etq]')].map(x => x.dataset.etq + (x.classList.contains('on') ? '*' : '')).join(','));
  ok(chips === 'nova*,aprend,rev,solida,dom,ref', 'o cartão da palavra mostra as 6 etiquetas, a atual marcada: ' + chips);
  const antes = await p.evaluate(() => ({ novas: today().novas, revs: today().revs, dom: counts().dom, c: JSON.stringify(S.c), r: JSON.stringify(S.r), missao: JSON.stringify(S.missao) }));
  await p.click('.modal [data-etq="dom"]'); await p.waitForTimeout(150);
  const dep = await p.evaluate(i => { const w = S.w[i]; return { st: statusOf(i), s: w.s, m: w.m, n: w.n, l: !!w.l, novas: today().novas, revs: today().revs, dom: counts().dom,
    naFila: dueList().includes(i), modal: !!document.querySelector('.modal'), c: JSON.stringify(S.c), r: JSON.stringify(S.r), missao: JSON.stringify(S.missao) }; }, alvo);
  ok(dep.st === 'dom' && dep.s === 8 && dep.m && dep.n === null && dep.l, 'um toque em Dominada deixa a palavra dominada (estágio 8, sem próxima revisão)');
  ok(!dep.naFila, 'palavra dominada à mão não entra nas revisões');
  ok(dep.novas === antes.novas && dep.revs === antes.revs, 'não conta como palavra nova nem como revisão do dia');
  ok(dep.dom === antes.dom + 1, 'o contador de dominadas sobe 1');
  ok(!dep.modal, 'o cartão fecha depois de trocar');
  ok(dep.c === antes.c && dep.r === antes.r && dep.missao === antes.missao, 'blocos, reduções e missão intactos');
  const saveOk = await p.evaluate(i => { const q = normaliza(unpack(JSON.parse(JSON.stringify(pack())))); return q.w[i] && q.w[i].m && q.w[i].s === 8; }, alvo);
  ok(saveOk, 'a etiqueta sobrevive ao salvar e abrir de novo');
  const cadeia = await p.evaluate(i => {
    const r = {};
    trocarEtiqueta(i, 'aprend'); r.aprend = [statusOf(i), S.w[i].s, !!S.w[i].n];
    trocarEtiqueta(i, 'rev'); r.rev = [statusOf(i), S.w[i].s, !!S.w[i].n];
    trocarEtiqueta(i, 'solida'); r.solida = [statusOf(i), S.w[i].s, !!S.w[i].n];
    trocarEtiqueta(i, 'ref'); r.ref = [statusOf(i), S.w[i].r, !!S.w[i].n];
    trocarEtiqueta(i, 'dom'); r.dom = statusOf(i);
    r.mesma = trocarEtiqueta(i, 'dom');
    trocarEtiqueta(i, 'nova'); r.nova = [statusOf(i), !!S.w[i]];
    return r; }, alvo);
  ok(cadeia.aprend.join() === 'aprend,1,true' && cadeia.rev.join() === 'rev,4,true' && cadeia.solida.join() === 'solida,7,true', 'Aprendendo, Em revisão e Sólida caem na faixa certa e ganham próxima revisão');
  ok(cadeia.ref.join() === 'ref,true,true' && cadeia.dom === 'dom' && cadeia.mesma === false, 'Reforço agenda para amanhã; repetir a mesma etiqueta não faz nada');
  ok(cadeia.nova.join() === 'nova,false', 'Nova volta a palavra para o começo');

  // ================= VERBO DO DIA =================
  await fresh();
  ok(await p.evaluate(() => GOAL_VERB === 1), 'meta de verbos: 1 por dia');
  const v0 = await p.evaluate(() => { go('verbos'); return { btn: !!document.querySelector('#bVerb'), txt: document.querySelector('#bVerb').textContent, hero: !!document.querySelector('.vd-hero'), hoje: S.vb.hoje }; });
  ok(v0.btn && v0.hero && v0.txt === 'Estudar verbo' && v0.hoje === null, 'tela Verbos: botão "Estudar verbo", nenhum verbo sorteado ainda');
  await p.click('#bVerb'); await p.waitForTimeout(200);
  const s1 = await p.evaluate(() => ({ id: SESSION.id, modo: SESSION.modo, fase: SESSION.fase, hoje: S.vb.hoje, k: dayKey(), aprendido: vbLearned(SESSION.id),
    resumo: !!document.querySelector('.vb-resumo') && document.querySelector('.vb-resumo').textContent.length > 3 }));
  ok(s1.modo === 'estudo' && s1.fase === 'formas' && s1.hoje && s1.hoje.id === s1.id && s1.hoje.k === s1.k && !s1.aprendido, 'o botão sorteia o verbo do dia e abre o estudo: ' + s1.id);
  ok(s1.resumo, 'a primeira tela mostra o verbo com o resumo do que ele quer dizer');
  // voltar à tela mostra o mesmo verbo; "sortear outro" troca
  const mesmo = await p.evaluate(() => { const a = S.vb.hoje.id; go('verbos'); const t = document.querySelector('.vd-word').textContent; return [a, t, verbDoDia() === a]; });
  ok(mesmo[1] === mesmo[0] && mesmo[2], 'voltando, o verbo do dia continua o mesmo');
  const outro = await p.evaluate(() => { const a = S.vb.hoje.id; document.querySelector('#bSortear').click(); return [a, S.vb.hoje.id, document.querySelector('.vd-word').textContent]; });
  ok(outro[1] !== outro[0] && outro[2] === outro[1], 'Sortear outro troca o verbo: ' + outro[0] + ' → ' + outro[1]);

  // estudar até o fim: entra na agenda como as palavras
  const swAntes = await p.evaluate(() => JSON.stringify(S.w));
  const fim = await p.evaluate(() => {
    const id = S.vb.hoje.id; startVerbStudy(id);
    SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view')); SESSION.render(document.querySelector('#view'));
    const x = S.vb.w[id], d = today();
    return { id, l: !!x.l, s: x.s, em: Math.round((x.n - Date.now()) / 60000), verb: d.verb, pend: pendenteVerb(), dom: verbDomain(id),
             texto: document.querySelector('#view').textContent, st: vbStatus(id) };
  });
  ok(fim.l && fim.s === 0 && fim.em >= 55 && fim.em <= 65, `primeiro estudo agenda a 1ª revisão para ~1h (em ${fim.em} min), como as palavras`);
  ok(fim.verb === 1 && fim.pend === 0 && fim.dom > 0, 'conta 1 verbo no dia, meta cumprida, domínio antigo continua subindo');
  ok(/Primeira revisão/.test(fim.texto) && /praticado/.test(fim.texto), 'tela final mostra quando é a primeira revisão');
  ok(await p.evaluate(swAntes0 => JSON.stringify(S.w) === swAntes0, swAntes), 'o SRS das palavras (S.w) não foi tocado');
  const apos = await p.evaluate(() => { go('verbos'); return { btn: document.querySelector('#bVerb').textContent, feita: /cumprida/.test(document.querySelector('.vd-hero').textContent) }; });
  ok(apos.btn === 'Estudar mais um verbo' && apos.feita, 'cumprida a meta, o botão vira "Estudar mais um verbo"');
  const novo = await p.evaluate(id => { const n = verbDoDia(); return [n !== id, !vbLearned(n)]; }, fim.id);
  ok(novo[0] && novo[1], 'o próximo sorteio é de outro verbo ainda não estudado');

  // ================= REVISÃO =================
  const rev0 = await p.evaluate(id => ({ due: vbDue().length, daAgora: vbDue().includes(id) }), fim.id);
  ok(rev0.due === 0, 'recém-estudado ainda não está vencido');
  await p.evaluate(id => { S.vb.w[id].n = Date.now() - 1000; go('verbos'); }, fim.id);
  const rv = await p.evaluate(id => ({ due: vbDue(), btn: !!document.querySelector('#bRevVerb'), home: (go('home'), document.querySelector('.hoje').textContent) }), fim.id);
  ok(rv.due.join() === fim.id && rv.btn, 'vencido, o verbo aparece em "Revisões de verbos" com botão');
  ok(/1 revisão/.test(rv.home), 'a Home mostra a revisão de verbo pendente na trilha de Verbos');
  const na = await p.evaluate(() => { today().novas = GOAL_NEW; for (const id in S.w) if (S.w[id].n && S.w[id].n <= Date.now()) S.w[id].n = Date.now() + 1e9; const x = nextAction(); return x.t + '|' + x.txt; });
  ok(/^verb\|Revisar 1 verbo/.test(na), 'sem palavras vencidas, a próxima ação da Home é revisar o verbo: ' + na);

  const revOk = await p.evaluate(id => {
    go('verbos'); document.querySelector('#bRevVerb').click();
    const ini = { modo: SESSION.modo, fase: SESSION.fase, n: SESSION.pratica.length, id: SESSION.id };
    const verbAntes = today().verb;
    SESSION.acertos = SESSION.pratica.length; SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view'));
    const x = S.vb.w[id];
    return { ini, s: x.s, r: x.r, em: Math.round((x.n - Date.now()) / 3600000), verb: today().verb - verbAntes, vrev: today().vrev, txt: document.querySelector('#view').textContent }; }, fim.id);
  ok(revOk.ini.modo === 'revisao' && revOk.ini.fase === 'pratica' && revOk.ini.n >= 4 && revOk.ini.id === fim.id, 'revisão abre direto na prática (' + revOk.ini.n + ' perguntas)');
  ok(revOk.s === 1 && !revOk.r && revOk.em >= 1 && revOk.verb === 0 && revOk.vrev === 1, `acertando, vai para a etapa 2 (s=1) e agenda a próxima; não conta como verbo novo do dia (revisão registrada: ${revOk.vrev})`);
  ok(/Revisão 1 de 8 concluída/.test(revOk.txt) && /revisado/.test(revOk.txt), 'tela final da revisão explica a etapa e a próxima data');

  const revRuim = await p.evaluate(id => {
    S.vb.w[id].n = Date.now() - 1000; startVerbReview();
    SESSION.acertos = 0; SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view'));
    const x = S.vb.w[id]; const n = new Date(x.n);
    return { s: x.s, r: x.r, e: x.e, status: vbStatus(id), amanha: n.getDate() !== new Date().getDate() && n.getHours() === 9 }; }, fim.id);
  ok(revRuim.s === 1 && revRuim.r && revRuim.e === 1 && revRuim.status === 'ref' && revRuim.amanha, 'errando muito: não avança, vira Reforço e volta amanhã às 9h');

  const treino = await p.evaluate(id => {
    S.vb.w[id].n = Date.now() + 5 * 86400000; const antes = JSON.stringify(S.vb.w[id]);
    startVerbStudy(id); SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view'));
    return JSON.stringify(S.vb.w[id]) === antes; }, fim.id);
  ok(treino, 'estudar de novo um verbo que não está vencido não mexe na agenda');

  const dominar = await p.evaluate(id => {
    const x = S.vb.w[id]; x.s = 7; x.r = false; x.n = Date.now() - 1000;
    startVerbReview(); SESSION.acertos = SESSION.pratica.length; SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view'));
    return { s: x.s, m: x.m, st: vbStatus(id), due: vbDue().includes(id), txt: document.querySelector('#view').textContent }; }, fim.id);
  ok(dominar.s === 8 && dominar.m && dominar.st === 'dom' && !dominar.due && /dominado/.test(dominar.txt), 'passar a 8ª revisão deixa o verbo dominado e tira das revisões');

  // ================= SALVAR / CELULAR =================
  const salvo = await p.evaluate(id => { const q = normaliza(unpack(JSON.parse(JSON.stringify(pack())))); const a = q.vb.w[id];
    return { ok: !!a && a.m && a.s === 8 && a.l > 0, hoje: !!q.vb.hoje, vrev: q.dias[dayKey()].vrev >= 2, verbAntigo: Object.keys(q.verb).length > 0 }; }, fim.id);
  ok(salvo.ok && salvo.hoje && salvo.vrev && salvo.verbAntigo, 'verbos estudados, verbo do dia e revisões do dia sobrevivem ao salvar; progresso antigo (S.verb) mantido');
  const velho = await p.evaluate(doc => { const q = normaliza(unpack(doc)); return q.vb && Object.keys(q.vb.w).length === 0 && q.vb.hoje === null; }, REAL);
  ok(velho, 'salvamento antigo (sem verbos novos) abre normal');
  await p.close();

  const m = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  m.on('pageerror', e => errs.push('PAGEERROR (cel): ' + e.message));
  await m.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
  await m.addInitScript(() => { window.claude = { use: async () => null }; });
  await m.goto(APP); await m.waitForTimeout(400);
  const cel = await m.evaluate(doc => { S = normaliza(unpack(doc)); sorteiaVerbo(); go('verbos');
    const r = { lar: document.documentElement.scrollWidth, hero: !!document.querySelector('.vd-hero .vd-word') };
    go('bank'); openWord(0);
    r.larModal = document.documentElement.scrollWidth; r.etq = document.querySelectorAll('.modal [data-etq]').length; return r; }, REAL);
  ok(cel.lar <= 392 && cel.hero, `celular: tela Verbos cabe na largura (${cel.lar}px)`);
  ok(cel.larModal <= 392 && cel.etq === 6, 'celular: cartão da palavra com as 6 etiquetas cabe na tela');
  await m.close();

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close(); process.exit(falhas ? 1 : 0);
})();
