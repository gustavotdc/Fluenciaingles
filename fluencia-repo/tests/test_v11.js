const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA') + '  ' + m);

  // capability assets falsa + intercepta /_blob/ para as imagens renderizarem
  await p.addInitScript(() => {
    window.__assets = new Map();
    let n = 0;
    window.claude = {
      use: async name => {
        if (name === 'assets') return {
          upload: async (blob, opts) => {
            const id = ('a' + (++n)).padEnd(32, '0');
            window.__assets.set(id, { sizeBytes: blob.size, contentType: (opts && opts.type) || blob.type });
            return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: (opts && opts.type) || blob.type };
          },
          list: async () => ({
            assets: [...window.__assets.entries()].map(([id, v]) => ({ id, url: '/_blob/' + id, ...v, createdAt: '' })),
            usage: { files: window.__assets.size, bytes: [...window.__assets.values()].reduce((a, v) => a + v.sizeBytes, 0), maxFiles: 500, maxBytes: 104857600 }
          }),
          delete: async id => { const had = window.__assets.delete(id); return { deleted: had }; }
        };
        return null;
      }
    };
  });
  await p.route('**/_blob/**', r => r.fulfill({
    status: 200, contentType: 'image/gif',
    body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')
  }));

  await p.goto(APP);
  await p.waitForTimeout(700);

  // ---------- áudio removido por completo ----------
  const limpo = await p.evaluate(() => {
    const src = document.querySelector('script') ? document.documentElement.innerHTML : '';
    return {
      falar: typeof window.falar,
      btnSom: typeof window.btnSom,
      spk: document.querySelectorAll('.spk').length,
      say: document.querySelectorAll('[data-say]').length,
      menciona: /speechSynthesis|btnSom|audIndex/.test(src)
    };
  });
  ok(limpo.falar === 'undefined' && limpo.btnSom === 'undefined', 'funções de áudio não existem mais');
  ok(limpo.spk === 0 && limpo.say === 0 && !limpo.menciona, 'nenhum vestígio de áudio na página');

  // ---------- assets conectado ----------
  ok(await p.evaluate(() => temImagens()) === true, 'capability de imagens conectada');

  // ---------- upload de imagem ----------
  const up = await p.evaluate(async () => {
    // gera um PNG de verdade num canvas e envia como se fosse arquivo
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 2000, 1200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'cena.png', { type: 'image/png' });
    const antes = blob.size;
    const okk = await subirImagem(0, file);
    const id = imgOf(0);
    return { okk, id, antes, depois: window.__assets.get(id).sizeBytes, tipo: window.__assets.get(id).contentType };
  });
  ok(up.okk === true && !!up.id, 'imagem enviada e vinculada à palavra 0: ' + up.id);
  ok(up.tipo === 'image/jpeg' && up.depois < up.antes, `reduzida antes de subir: ${Math.round(up.antes/1024)}KB -> ${Math.round(up.depois/1024)}KB, ${up.tipo}`);

  // ---------- a imagem aparece no estudo ----------
  await p.evaluate(() => { S.w[0] = {s:0,n:null,l:null,e:0,a:0,m:false,r:false}; startLearn(); SESSION.ids = [0]; SESSION.i = 0; SESSION.step = 2; render(); });
  await p.waitForTimeout(250);
  const naEtapa = await p.evaluate(() => {
    const im = document.querySelector('.stage .pavimg img');
    return { tem: !!im, src: im && im.getAttribute('src'), botao: !!document.querySelector('[data-img]') };
  });
  ok(naEtapa.tem && /^\/_blob\//.test(naEtapa.src), 'imagem aparece na etapa do PAV: ' + naEtapa.src);
  ok(naEtapa.botao, 'botão de imagem presente na etapa do PAV');

  // ---------- chute: campo, comparação e sugestão ----------
  await p.evaluate(() => { SESSION.step = 5; SESSION.revealed = false; render(); });
  await p.waitForTimeout(200);
  ok(!!(await p.$('#chute')), 'campo de chute aparece no recall');

  const acerto = await p.evaluate(async () => {
    $('#chute').value = W[0][2];           // resposta certa
    $('#rev').click();
    await new Promise(r => setTimeout(r, 120));
    return { txt: $('.stage').textContent.replace(/\s+/g,' '), sug: !!document.querySelector('#ok.sug') };
  });
  ok(/✓ você escreveu/.test(acerto.txt), 'chute certo é marcado com ✓');
  ok(acerto.sug, 'o botão Acertei fica destacado quando o chute bate');

  const erro = await p.evaluate(async () => {
    SESSION.step = 5; SESSION.revealed = false; SESSION.chute = ''; render();
    await new Promise(r => setTimeout(r, 80));
    $('#chute').value = 'xxxx';
    $('#rev').click();
    await new Promise(r => setTimeout(r, 120));
    return { txt: $('.stage').textContent.replace(/\s+/g,' '), sug: !!document.querySelector('#err.sug') };
  });
  ok(/✗ você escreveu/.test(erro.txt) && erro.sug, 'chute errado é marcado com ✗ e destaca Errei');

  // ---------- tolerância do comparador ----------
  const tol = await p.evaluate(() => [
    avaliaChute('  Head ', 'head'),
    avaliaChute('to go', 'go'),
    avaliaChute('cabeca', 'cabeça'),
    avaliaChute('', 'head'),
    avaliaChute('hand', 'head')
  ]);
  ok(JSON.stringify(tol) === JSON.stringify([true, true, true, null, false]),
    'comparador tolera maiúscula, artigo e acento e recusa errado: ' + JSON.stringify(tol));

  // ---------- teclado não vaza para a sessão ----------
  const vaza = await p.evaluate(async () => {
    SESSION.step = 5; SESSION.revealed = false; render();
    await new Promise(r => setTimeout(r, 80));
    const el = $('#chute'); el.focus(); el.value = 'he';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    return SESSION.revealed;
  });
  ok(vaza === false, 'espaço digitado no campo não revela a resposta');

  // ---------- revisão mostra imagem e chute ----------
  const rev = await p.evaluate(async () => {
    S.w[0] = {s:4,n:Date.now()-1000,l:Date.now()-9e6,e:0,a:1,m:false,r:false};
    startReview([0]);
    await new Promise(r => setTimeout(r, 100));
    const frente = { img: !!document.querySelector('.stage .pavimg'), chute: !!$('#chute'), modo: modeFor(5).mostra };
    $('#chute').value = W[0][2];
    SESSION.reveal();
    await new Promise(r => setTimeout(r, 100));
    return { frente, verso: $('.stage').textContent.replace(/\s+/g,' '), btnImg: !!document.querySelector('[data-img]') };
  });
  ok(rev.frente.modo === 'pav' && rev.frente.img && rev.frente.chute,
    'revisão 5 mostra a imagem como pista, com campo de chute');
  ok(/✓/.test(rev.verso) && rev.btnImg, 'verso da revisão confere o chute e oferece trocar imagem');

  // ---------- escudo de sequência ----------
  const esc = await p.evaluate(() => {
    S = freshState(); S.criado = new Date('2026-09-01T12:00:00').getTime();
    const dia = (k, ok) => { S.dias[k] = {novas: ok?25:0, revs:0, dom:0, red:0, chk:0, li:true, sp:true, gr:true, limpo:!!ok}; };
    const hoje = new Date();
    const key = n => dayKey(addDays(hoje, -n));
    for(let i=0;i<8;i++) dia(key(i), true);
    dia(key(3), false);                     // um buraco no meio
    const a = streak();
    dia(key(5), false);                     // segundo buraco
    const b2 = streak();
    dia(key(6), false);                     // terceiro: acaba a folga
    const c = streak();
    return {a:{cur:a.cur,sobra:a.escudosSobrando}, b:{cur:b2.cur,sobra:b2.escudosSobrando}, c:{cur:c.cur,sobra:c.escudosSobrando}, prot:b2.protegidos.length};
  });
  ok(esc.a.cur === 7 && esc.a.sobra === 1, `1 buraco: sequência segue em ${esc.a.cur} dias, sobra ${esc.a.sobra} folga`);
  ok(esc.b.cur === 6 && esc.b.sobra === 0, `2 buracos: sequência segue em ${esc.b.cur} dias, folgas zeradas`);
  ok(esc.c.cur === 4 && esc.c.sobra === 0, `3 buracos: a sequência quebra e cai para ${esc.c.cur}`);
  ok(esc.prot === 2, 'os 2 dias cobertos ficam marcados no calendário');

  // ---------- marcos curtos ----------
  const marcos = await p.evaluate(() => [0,9,10,24,60,150,1199].map(proximoMarco));
  ok(JSON.stringify(marcos) === JSON.stringify([10,10,25,25,75,200,1200]), 'marcos curtos: ' + JSON.stringify(marcos));
  await p.evaluate(() => { S = freshState(); for(let i=0;i<7;i++){ S.w[i]={s:8,n:null,l:1,e:0,a:1,m:true,r:false}; } go('home'); });
  await p.waitForTimeout(200);
  const painel = await p.textContent('#view');
  ok(/Próximo marco/.test(painel) && /7 \/ 10/.test(painel.replace(/\s+/g,' ')), 'painel mostra o marco próximo em vez do total');
  ok(/folga/.test(painel), 'painel mostra as folgas do mês');

  // ---------- persistência das imagens ----------
  const persist = await p.evaluate(() => {
    S.img = {0: 'a1'.padEnd(32,'0'), 5: 'a2'.padEnd(32,'0')};
    const u = unpack(JSON.parse(JSON.stringify(pack())));
    return { n: Object.keys(u.img).length, v: u.img[5] };
  });
  ok(persist.n === 2 && /^a2/.test(persist.v), 'ids de imagem vão e voltam na sincronização');
  const migra = await p.evaluate(() => {
    const antigo = { f:3, criado:1, ultimo:2, w:{}, dias:{}, pav:{}, r:{}, c:{} };
    return !!normaliza(unpack(antigo)).img;
  });
  ok(migra, 'estado antigo sem imagens migra sem quebrar');

  // ---------- banco: filtro e marcação ----------
  await p.evaluate(() => { S.img = {0:'a1'.padEnd(32,'0')}; bankFilter = {q:'',st:'_img',dia:'',n:60}; go('bank'); });
  await p.waitForTimeout(250);
  const banco = await p.evaluate(() => ({ linhas: document.querySelectorAll('#list .wrow').length, txt: $('#list').textContent }));
  ok(banco.linhas === 1 && /imagem/.test(banco.txt), 'filtro "com imagem" no banco: ' + banco.linhas + ' resultado');

  // ---------- remoção de imagem ----------
  const rem = await p.evaluate(async () => {
    const id = imgOf(0);
    await removerImagem(0);
    return { aponta: imgOf(0), guardada: window.__assets.has(id) };
  });
  ok(rem.aponta === null && rem.guardada === false, 'remover apaga o vínculo e o arquivo');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  await b.close();
  process.exit(0);
})();
