const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');

const FAKE_TEXT = {
  titulo: 'The Late Order',
  linhas: [
    { en: 'The phone rang at nine.', pt: 'O telefone tocou às nove.' },
    { en: 'A man wanted his food.', pt: 'Um homem queria a comida dele.' },
    { en: 'It was two hours late.', pt: 'Estava duas horas atrasada.' },
    { en: 'She said sorry many times.', pt: 'Ela pediu desculpa muitas vezes.' },
    { en: 'In the end he laughed.', pt: 'No fim ele riu.' }
  ]
};

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA') + '  ' + m);

  await p.addInitScript(fake => {
    window.__prompts = []; window.__vib = [];
    window.__modo = 'ok';
    const sample = async () => { throw { code: 'invalid_request' }; };
    sample.json = async (input, opts) => {
      window.__prompts.push({ input, opts });
      if (window.__modo === 'erro') throw { code: 'invalid_json' };
      if (window.__modo === 'lento') { await new Promise((r, j) => {
        const t = setTimeout(() => r(), 5000);
        opts.signal && opts.signal.addEventListener('abort', () => { clearTimeout(t); j({ code: 'cancelled' }); });
      }); }
      return JSON.parse(JSON.stringify(fake));
    };
    sample.limits = async () => ({ maxPromptBytes: 65536 });
    window.claude = { use: async n => n === 'sample' ? sample : (n === 'assets' ? {
      upload: async () => ({ id: 'x'.repeat(32), url: '/_blob/' + 'x'.repeat(32), sizeBytes: 1, contentType: 'image/jpeg' }),
      list: async () => ({ assets: [], usage: { files: 0, bytes: 0, maxFiles: 9, maxBytes: 9 } }),
      delete: async () => ({ deleted: true })
    } : null) };
    navigator.vibrate = v => { window.__vib.push(v); return true; };
  }, FAKE_TEXT);
  await p.route('**/_blob/**', r => r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') }));

  await p.goto(APP);
  await p.waitForTimeout(700);

  // ---------- famílias ----------
  const fam = await p.evaluate(() => {
    const idx = {}; for (let i = 0; i < W.length; i++) idx[W[i][2]] = i;
    const pega = w => (FAM[idx[w]] || []).map(x => x[0] + ':' + x[1]).join(' ');
    return { n: Object.keys(FAM).length, go: pega('go'), child: pega('child'), big: pega('big'), water: pega('water') };
  });
  ok(fam.n === 867, 'famílias carregadas: ' + fam.n + ' palavras');
  ok(/passado:went/.test(fam.go) && /particípio:gone/.test(fam.go), 'verbo irregular: go -> ' + fam.go);
  ok(/plural:children/.test(fam.child), 'plural irregular: child -> ' + fam.child);
  ok(/mais:bigger/.test(fam.big) && !fam.water, 'adjetivo tem grau, incontável não tem família');

  // ---------- aba Leitura existe ----------
  const abas = await p.$$eval('#tabs button', bs => bs.map(x => x.textContent));
  ok(abas.includes('Leitura'), 'abas: ' + abas.join(', '));
  ok(await p.evaluate(() => temLeitura()) === true, 'capability de escrita conectada');

  // ---------- gerar texto ----------
  // esvazia o banco pronto pra testar o caminho de geração ao vivo (o
  // fallback, usado só depois que os 150 textos prontos acabarem)
  await p.evaluate(() => { TXT_BANCO.splice(0); S = freshState(); for (let i = 0; i < 40; i++) S.w[i] = { s: 8, n: null, l: Date.now(), e: 0, a: 3, m: true, r: false }; go('ler'); });
  await p.waitForTimeout(250);
  await p.click('#gerar');
  await p.waitForTimeout(600);
  const pr = await p.evaluate(() => window.__prompts[0]);
  ok(/PALAVRAS QUE ELE JÁ DOMINA/.test(pr.input) && pr.input.includes('be,'), 'o prompt leva o vocabulário dominado');
  ok(/CENA DE HOJE/.test(pr.input), 'o prompt leva uma cena sorteada');
  ok(pr.opts.cache === false, 'não usa resposta em cache: cada texto é novo');
  ok(!/fon/.test(pr.input), 'o prompt não pede mais fonética (removida a pedido dele)');

  const st = await p.evaluate(() => ({ n: S.txt.length, t: S.txt[0].t, l: S.txt[0].l.length, d: S.txt[0].d === dayKey() }));
  ok(st.n === 1 && st.t === 'The Late Order' && st.l === 5 && st.d, 'texto guardado no estado: ' + JSON.stringify(st));

  // ---------- as duas passadas ----------
  await p.click('#lerHoje .lt-card');
  await p.waitForTimeout(250);
  let tela = await p.evaluate(() => ({ passo: SESSION.passo, txt: $('.leitura').textContent, en: document.querySelectorAll('.lt-en').length, pt: document.querySelectorAll('.lt-pt').length }));
  ok(tela.en === 5 && tela.pt === 0 && /The phone rang/.test(tela.txt), 'passada 1 mostra só o inglês');
  ok(!/telefone/.test(tela.txt), 'passada 1 não vaza a tradução');

  await p.click('#nx'); await p.waitForTimeout(200);
  tela = await p.evaluate(() => ({ en: document.querySelectorAll('.lt-en').length, pt: document.querySelectorAll('.lt-pt').length, txt: $('.leitura').textContent }));
  ok(tela.en === 5 && tela.pt === 5 && /telefone/.test(tela.txt), 'passada 2 mostra inglês com tradução');

  await p.click('#fim'); await p.waitForTimeout(300);
  const lido = await p.evaluate(() => ({ lido: S.txt[0].lido, dia: S.dias[dayKey()].txt, vib: window.__vib.length }));
  ok(lido.lido === 1 && lido.dia === 1, 'texto marcado como lido e contado no dia');
  ok(lido.vib > 0, 'vibrou ao concluir a leitura');

  // ---------- erro e cancelamento ----------
  await p.evaluate(() => { window.__modo = 'erro'; });
  await p.click('#gerar'); await p.waitForTimeout(700);
  const tst = await p.evaluate(() => ({ n: S.txt.length, toast: $('#toast').textContent }));
  ok(tst.n === 1 && /quebrado/.test(tst.toast), 'falha na geração não corrompe nada: ' + tst.toast);

  await p.evaluate(() => { window.__modo = 'lento'; });
  await p.click('#gerar'); await p.waitForTimeout(400);
  ok(!!(await p.$('#parar')), 'enquanto escreve aparece o botão Parar');
  await p.click('#parar'); await p.waitForTimeout(500);
  const canc = await p.evaluate(() => ({ g: gerando, n: S.txt.length }));
  ok(canc.g === null && canc.n === 1, 'parar cancela sem deixar lixo');
  await p.evaluate(() => { window.__modo = 'ok'; });

  // ---------- próxima ação e painel ----------
  const na = await p.evaluate(() => {
    S = freshState(); for (let i = 0; i < 40; i++) S.w[i] = { s: 8, n: null, l: 1, e: 0, a: 3, m: true, r: false };
    const d = today(); d.novas = 25; d.limpo = true; d.red = 3; d.chk = 5; d.verb = 3;
    for (let i = 0; i < 3; i++) { const x = fd('red', i); x.l = 1; x.n = Date.now() + 9e8; x.s = 1; }
    for (let i = 0; i < 5; i++) { const x = fd('chk', i); x.l = 1; x.n = Date.now() + 9e8; x.s = 1; }
    return nextAction().t;
  });
  ok(na === 'txt', 'depois dos blocos e verbos a próxima ação é a leitura: ' + na);
  await p.evaluate(() => go('home'));
  await p.waitForTimeout(250);
  ok(/Leitura/.test(await p.textContent('#view')), 'painel mostra o bloco de Leitura');

  // ---------- curiosidade e imagem borrada na revisão seca ----------
  const cur = await p.evaluate(async () => {
    S = freshState(); S.img = { 0: 'x'.repeat(32) };
    S.w[0] = { s: 6, n: Date.now() - 1000, l: Date.now() - 9e8, e: 2, a: 5, m: false, r: false };
    startReview([0]);
    await new Promise(r => setTimeout(r, 100));
    return { modo: modeFor(7).mostra, curio: !!document.querySelector('.curio'), txt: (document.querySelector('.curio') || {}).textContent,
             borr: !!document.querySelector('.pavimg.borrada'), nitida: !!document.querySelector('.pavimg:not(.borrada)') };
  });
  ok(cur.modo === 'pt' && cur.curio && cur.borr && !cur.nitida,
    'revisão 7 mostra só o português, a imagem borrada e uma curiosidade: "' + (cur.txt || '').trim() + '"');
  const dep = await p.evaluate(async () => { SESSION.reveal(); await new Promise(r => setTimeout(r, 100));
    return { nitida: !!document.querySelector('.pavimg:not(.borrada)'), fam: !!document.querySelector('.fam') }; });
  ok(dep.nitida, 'ao revelar, a imagem sai do borrado');
  ok(dep.fam, 'o verso mostra a família da palavra');

  // ---------- fim em alta ----------
  const fecho = await p.evaluate(async () => {
    S = freshState();
    for (let i = 0; i < 30; i++) S.w[i] = { s: 8, n: null, l: 1, e: 0, a: 3, m: true, r: false };
    for (let i = 30; i < 34; i++) S.w[i] = { s: 2, n: Date.now() - 1000, l: 1, e: 0, a: 1, m: false, r: false };
    startReview([30, 31, 32, 33]);
    // 3 acertos, 1 erro; o erro volta como reteste e é acertado no fim
    for (let n = 0; n < 4; n++) { SESSION.revealed = true; SESSION.answer(n < 3); await new Promise(r => setTimeout(r, 40)); }
    while (SESSION.q.length) { SESSION.revealed = true; SESSION.answer(true); await new Promise(r => setTimeout(r, 40)); }
    return { tela: $('.stage').textContent.replace(/\s+/g, ' '), temFecho: /Fechando em alta/.test($('.stage').textContent), melhor: SESSION.melhor };
  });
  ok(fecho.temFecho, 'sessão com erro termina numa carta fácil para fechar em alta');
  ok(fecho.melhor >= 3, 'guarda a melhor sequência da sessão: ' + fecho.melhor);
  const celeb = await p.evaluate(async () => {
    $('#rev').click(); await new Promise(r => setTimeout(r, 60));
    $('#fim').click(); await new Promise(r => setTimeout(r, 60));
    return $('.stage').textContent.replace(/\s+/g, ' ');
  });
  ok(/melhor sequ.ncia da sess.o: 3/.test(celeb), 'a tela final destaca o pico: ' + celeb.slice(0, 90));

  const semFecho = await p.evaluate(async () => {
    S = freshState();
    for (let i = 0; i < 30; i++) S.w[i] = { s: 8, n: null, l: 1, e: 0, a: 3, m: true, r: false };
    for (let i = 30; i < 34; i++) S.w[i] = { s: 2, n: Date.now() - 1000, l: 1, e: 0, a: 1, m: false, r: false };
    startReview([30, 31, 32, 33]);
    for (let n = 0; n < 4; n++) { SESSION.revealed = true; SESSION.answer(true); await new Promise(r => setTimeout(r, 40)); }
    return /Fechando em alta/.test($('.stage').textContent);
  });
  ok(semFecho === false, 'quem termina acertando não leva carta extra');

  // ---------- vibração ----------
  const vib = await p.evaluate(async () => {
    window.__vib = [];
    S.w[40] = { s: 2, n: Date.now() - 1000, l: 1, e: 0, a: 1, m: false, r: false };
    startReview([40]); SESSION.revealed = true; SESSION.answer(true);
    const acerto = window.__vib.slice();
    S.w[41] = { s: 2, n: Date.now() - 1000, l: 1, e: 0, a: 1, m: false, r: false };
    window.__vib = []; startReview([41]); SESSION.revealed = true; SESSION.answer(false);
    return { acerto, erro: window.__vib.slice() };
  });
  ok(vib.acerto.length === 1 && typeof vib.acerto[0] === 'number', 'acerto vibra uma vez curta: ' + JSON.stringify(vib.acerto));
  ok(Array.isArray(vib.erro[0]) && vib.erro[0].length === 3, 'erro vibra em dois toques: ' + JSON.stringify(vib.erro));
  const desl = await p.evaluate(() => { vibLigada = false; window.__vib = []; vibrar(true); vibLigada = true; return window.__vib.length; });
  ok(desl === 0, 'desligada, não vibra');

  // ---------- persistência ----------
  const per = await p.evaluate(() => {
    S.txt = [{ d: dayKey(), ctx: 'teste', t: 'T', l: [['a', 'b', 'c']], lido: 1 }];
    today().txt = 2;
    const u = unpack(JSON.parse(JSON.stringify(pack())));
    return { n: u.txt.length, t: u.txt[0].t, dia: u.dias[dayKey()].txt, bytes: JSON.stringify(pack()).length };
  });
  ok(per.n === 1 && per.t === 'T' && per.dia === 2, 'textos e contador vão e voltam na sincronização');
  const tamanho = await p.evaluate(() => {
    S = freshState();
    for (let i = 0; i < 1200; i++) S.w[i] = { s: 8, n: Date.now(), l: Date.now(), e: 2, a: 9, m: true, r: false };
    for (let i = 0; i < 220; i++) S.dias[dayKey(addDays(new Date(), -i))] = { novas: 25, revs: 40, dom: 10, li: 1, sp: 1, gr: 1, limpo: 1, red: 3, chk: 5, txt: 2 };
    S.img = {}; for (let i = 0; i < 400; i++) S.img[i] = 'y'.repeat(32);
    S.txt = []; for (let i = 0; i < 12; i++) S.txt.push({ d: dayKey(), ctx: 'x'.repeat(50), t: 'y'.repeat(30), l: Array.from({length:14},()=>['e'.repeat(45),'f'.repeat(50),'p'.repeat(45)]), lido: 1 });
    return Math.round(JSON.stringify(pack()).length / 1024);
  });
  ok(tamanho < 250, 'estado no pior caso: ' + tamanho + ' KB (limite 256)');
  const migra = await p.evaluate(() => {
    const antigo = { f: 3, criado: 1, ultimo: 2, w: {}, dias: { '2026-01-01': [5, 2, 0, 1, 0, 0, 1, 0, 0] }, pav: {}, r: {}, c: {} };
    const u = normaliza(unpack(antigo));
    return { txt: Array.isArray(u.txt), dia: u.dias['2026-01-01'].txt };
  });
  ok(migra.txt && migra.dia === 0, 'estado anterior migra sem quebrar');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  await b.close();
  process.exit(0);
})();
