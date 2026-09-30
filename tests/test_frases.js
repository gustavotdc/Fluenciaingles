const { chromium } = require('playwright');
const path = require('path').resolve(__dirname, '../dist/index.html');

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') erros.push('CONSOLE: ' + m.text()); });

  // voz falsa: o ambiente headless nao tem TTS
  await p.addInitScript(() => {
    const vozes = [{ name: 'Fake US', lang: 'en-US', localService: true, default: true }];
    window.__falas = [];
    const fake = {
      getVoices: () => vozes, speak: u => { window.__falas.push([u.text, u.rate]); },
      cancel: () => {}, resume: () => {}, paused: false, speaking: false, pending: false
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true, writable: true });
  });

  await p.goto('file://' + path);
  await p.waitForTimeout(700);

  const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA') + '  ' + m);

  // dados carregados
  const d = await p.evaluate(() => ({ w: W.length, r: R.length, c: C.length }));
  ok(d.w === 3000 && d.r === 67 && d.c === 413, `dados W=${d.w} R=${d.r} C=${d.c}`);

  // aba Frases existe
  const abas = await p.$$eval('#tabs button', bs => bs.map(x => x.textContent));
  ok(abas.includes('Frases'), 'aba Frases: ' + abas.join(', '));

  await p.click('#tabs button[data-t="frases"]');
  await p.waitForTimeout(200);
  const cards = await p.$$eval('#view [data-go]', bs => bs.map(x => x.dataset.go));
  ok(cards.join(',') === 'red,chk', 'dois cartoes: ' + cards.join(','));

  // ---------- REDUCOES ----------
  await p.click('#view [data-go="red"]');
  await p.waitForTimeout(200);
  let step = await p.textContent('.step');
  ok(/01/.test(step), 'reducao etapa 1: ' + step.trim());
  ok((await p.$$('[data-say]')).length === 0, 'nenhum botao de audio sobrou');

  await p.click('#nx'); await p.waitForTimeout(150);
  step = await p.textContent('.step');
  ok(/02/.test(step), 'reducao etapa 2: ' + step.trim());
  const temRegra = await p.$('.hintbox');
  ok(!!temRegra, 'regra aparece na etapa 2');

  await p.click('#nx'); await p.waitForTimeout(150);
  ok(!!(await p.$('#rev')) && !!(await p.$('#chute')), 'reducao etapa 3 = teste com campo de chute');
  await p.click('#rev'); await p.waitForTimeout(150);
  ok(!!(await p.$('#ok')), 'botoes errei/acertei apos revelar');
  await p.click('#ok'); await p.waitForTimeout(200);

  let est = await p.evaluate(() => ({ red: S.dias[dayKey()].red, r0: S.r[0], fd: S.frasesDesde }));
  ok(est.red === 1, 'contador de reducoes do dia = ' + est.red);
  ok(!!est.r0 && est.r0.l && est.r0.n, 'reducao 0 agendada: ' + JSON.stringify(est.r0));
  ok(!!est.fd, 'frasesDesde definido: ' + est.fd);

  // termina a meta de reducoes (3)
  for (let i = 0; i < 2; i++) {
    await p.click('#nx'); await p.waitForTimeout(120);
    await p.click('#nx'); await p.waitForTimeout(120);
    await p.click('#rev'); await p.waitForTimeout(120);
    await p.click('#ok'); await p.waitForTimeout(150);
  }
  const fim = await p.textContent('.celebrate');
  ok(/completos/.test(fim), 'fim: ' + fim.replace(/\s+/g, ' ').trim().slice(0, 70));
  est = await p.evaluate(() => S.dias[dayKey()].red);
  ok(est === 3, 'meta de reducoes cumprida: ' + est);

  // ---------- BLOCOS ----------
  await p.click('#home'); await p.waitForTimeout(150);
  await p.click('#tabs button[data-t="frases"]'); await p.waitForTimeout(150);
  await p.click('#view [data-go="chk"]'); await p.waitForTimeout(200);
  const ptPrimeiro = await p.textContent('.word-pt');
  ok(ptPrimeiro.trim().length > 0, 'bloco comeca pelo portugues: ' + ptPrimeiro.trim());
  await p.click('#nx'); await p.waitForTimeout(150);
  const temEn = await p.textContent('.word-en');
  const temPron = await p.$('.pron');
  const temPt = await p.$$eval('.muted', ns => ns.map(n => n.textContent.trim()).filter(Boolean));
  ok(temEn.trim().length > 0 && !!temPron, 'bloco etapa 2 tem ingles + fonetica: ' + temEn.trim());
  ok(temPt.length > 0, 'traducao PT presente na etapa 2: ' + temPt[0]);

  await p.click('#nx'); await p.waitForTimeout(150);
  await p.click('#rev'); await p.waitForTimeout(150);
  const revelado = await p.evaluate(() => $('.stage').textContent.replace(/\s+/g, ' '));
  ok(/\S/.test(revelado), 'revelacao do bloco: ' + revelado.slice(0, 90));
  await p.click('#ok'); await p.waitForTimeout(200);
  const chk1 = await p.evaluate(() => S.dias[dayKey()].chk);
  ok(chk1 === 1, 'contador de blocos = ' + chk1);

  // ---------- ERRO gera reteste ----------
  await p.click('#nx'); await p.waitForTimeout(120);
  await p.click('#nx'); await p.waitForTimeout(120);
  await p.click('#rev'); await p.waitForTimeout(120);
  const antes = await p.evaluate(() => SESSION.fila.length);
  await p.click('#err'); await p.waitForTimeout(200);
  const depois = await p.evaluate(() => SESSION.fila.length);
  ok(depois === antes - 1 + 1, `erro reenfileira: ${antes} -> ${depois}`);
  const temRedo = await p.evaluate(() => SESSION.fila.some(x => x.redo));
  ok(temRedo, 'item marcado como reteste');

  // ---------- persistencia pack/unpack ----------
  const roundtrip = await p.evaluate(() => {
    const p1 = pack();
    const u = unpack(JSON.parse(JSON.stringify(p1)));
    return {
      r: Object.keys(u.r).length, c: Object.keys(u.c).length,
      red: u.dias[dayKey()].red, chk: u.dias[dayKey()].chk, fd: u.frasesDesde,
      bytes: JSON.stringify(p1).length
    };
  });
  ok(roundtrip.r === 3 && roundtrip.red === 3, 'pack/unpack reducoes: ' + JSON.stringify(roundtrip));
  ok(roundtrip.c >= 2 && roundtrip.chk >= 1, 'pack/unpack blocos ok');
  ok(roundtrip.bytes < 200000, 'tamanho do estado: ' + roundtrip.bytes + ' bytes');

  // ---------- proxima acao ----------
  const na = await p.evaluate(() => {
    S = freshState(); S.frasesDesde = dayKey();
    const d = today(); d.novas = 25; d.limpo = true;
    return nextAction().t;
  });
  ok(na === 'red', 'depois do vocabulario a proxima acao e reducoes: ' + na);

  const na2 = await p.evaluate(() => {
    const d = today(); d.red = 3;
    for (let i = 0; i < 3; i++) { const x = fd('red', i); x.l = Date.now(); x.n = Date.now() + 9e8; x.s = 1; }
    return nextAction().t;
  });
  ok(na2 === 'chk', 'depois das reducoes vem blocos: ' + na2);

  // ---------- compatibilidade com estado antigo ----------
  const velho = await p.evaluate(() => {
    const antigo = { f: 2, criado: 1, ultimo: 2, w: { 0: [1, 0, 1700000, 0, 1, 0, 0] }, dias: { '2026-01-01': [5, 2, 0, 1, 0, 0, 1] }, pav: {} };
    const u = normaliza(unpack(antigo));
    return { w: Object.keys(u.w).length, red: u.dias['2026-01-01'].red, r: !!u.r, fd: !!u.frasesDesde };
  });
  ok(velho.w === 1 && velho.red === 0 && velho.r && velho.fd, 'estado antigo (f:2) migra: ' + JSON.stringify(velho));

  // ---------- dia completo historico nao quebra ----------
  const hist = await p.evaluate(() => {
    S = freshState(); S.frasesDesde = '2026-06-01';
    S.dias['2026-05-10'] = { novas: 25, revs: 0, dom: 0, red: 0, chk: 0, li: true, sp: true, gr: true, limpo: true };
    S.dias['2026-06-10'] = { novas: 25, revs: 0, dom: 0, red: 0, chk: 0, li: true, sp: true, gr: true, limpo: true };
    S.dias['2026-06-11'] = { novas: 25, revs: 0, dom: 0, red: 3, chk: 5, li: true, sp: true, gr: true, limpo: true };
    return [dayFull('2026-05-10'), dayFull('2026-06-10'), dayFull('2026-06-11')];
  });
  ok(hist[0] === true && hist[1] === false && hist[2] === true, 'dia completo: antigo vale, novo exige frases: ' + JSON.stringify(hist));

  console.log(erros.length ? '\nERROS:\n' + erros.join('\n') : '\nSem erros de console.');
  await b.close();
})();
