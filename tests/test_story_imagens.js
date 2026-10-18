// Story Rebuild com carrossel de imagens (17/10): imagens fixas na ordem certa, só as frases mudam de lugar.
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));
const HIST = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/stories.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  let falhas = 0; const errs = [];
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };

  // ---- dados
  const ilust = HIST.filter(s => s.cenas.every(c => c.img));
  ok(ilust.length === 3, `3 histórias com imagem em todas as cenas (${ilust.map(s => s.id).join(', ')})`);
  ok(ilust.every(s => s.cenas.length === 5 && s.cenas.every(c => /^<svg[^>]+viewBox="0 0 320 200"/.test(c.img) && c.img.length > 1500 && c.alt)), 'cada cena tem SVG completo e texto alternativo');
  ok(ilust.every(s => new Set(s.cenas.map(c => c.img)).size === 5), 'as 5 imagens de cada história são diferentes entre si');
  ok(HIST.filter(s => !s.cenas.every(c => c.img)).length === 4, 'as outras 4 histórias continuam só com texto');
  ok(ilust.every(s => s.cenas.every(c => !/<script|onload|onerror|href=/i.test(c.img))), 'SVGs sem script nem links');

  for (const [nome, vp, touch] of [['computador', { width: 1280, height: 860 }, false], ['celular', { width: 390, height: 844 }, true]]) {
    const p = await b.newPage({ viewport: vp, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 });
    p.on('pageerror', e => errs.push(nome + ' PAGEERROR: ' + e.message));
    await p.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
    await p.addInitScript(() => { window.claude = { use: async () => null }; });
    await p.goto(APP); await p.waitForTimeout(400);
    await p.evaluate(doc => { S = normaliza(unpack(doc)); go('academia'); }, REAL);

    const antes = await p.evaluate(() => JSON.stringify({ w: S.w, c: S.c, r: S.r, missao: S.missao }));
    const ini = await p.evaluate(id => {
      STORIES.forEach((s, i) => {}); const st = STORIES.find(x => x.id === id);
      SESSION = new StoryRebuildSession(); SESSION.story = st; SESSION.pool = embaralha(st.cenas.map(c => c.en)); render();
      const lar = document.documentElement.scrollWidth;
      return { slides: document.querySelectorAll('.sr-slide').length, svgs: document.querySelectorAll('.sr-slide svg').length,
               dots: document.querySelectorAll('.sr-dot').length, lar, blocos: document.querySelectorAll('[data-bloco]').length,
               nums: [...document.querySelectorAll('.sr-num')].map(x => x.textContent).join(',') };
    }, ilust[0].id);
    ok(ini.slides === 5 && ini.svgs === 5 && ini.dots === 5, `${nome}: carrossel com 5 imagens e 5 pontos`);
    ok(ini.nums === '1 / 5,2 / 5,3 / 5,4 / 5,5 / 5', `${nome}: imagens numeradas na ordem: ${ini.nums}`);
    ok(ini.blocos === 5, `${nome}: 5 frases embaralhadas para reordenar`);
    ok(ini.lar <= vp.width + 2, `${nome}: nada vaza na horizontal (${ini.lar}px)`);

    // a ordem das imagens nunca muda; só as frases
    const ordemImg = await p.evaluate(() => [...document.querySelectorAll('.sr-slide svg')].map(s => s.getAttribute('aria-label')));
    ok(ordemImg.join('|') === ilust[0].cenas.map(c => c.alt).join('|'), `${nome}: imagens na ordem certa da história`);

    // tocar numa frase avança o carrossel e NÃO recria o carrossel
    const marca = await p.evaluate(() => { const e = document.querySelector('#srTrack'); e.dataset.marca = '1'; return true; });
    await p.click('[data-bloco]'); await p.waitForTimeout(700);
    const dep = await p.evaluate(() => ({ marca: document.querySelector('#srTrack').dataset.marca, slide: SESSION.slide,
      dotOn: [...document.querySelectorAll('.sr-dot')].findIndex(d => d.classList.contains('on')),
      pre: document.querySelectorAll('.sr-dot.preenchido').length, montados: document.querySelectorAll('[data-montado]').length,
      numerado: !!document.querySelector('[data-montado] .tap-n') }));
    ok(dep.marca === '1', `${nome}: carrossel é preservado ao escolher frase (sem voltar ao início)`);
    ok(dep.slide === 1 && dep.dotOn === 1, `${nome}: depois da 1ª frase o carrossel vai para a cena 2`);
    ok(dep.pre === 1 && dep.montados === 1 && dep.numerado, `${nome}: frase escolhida aparece numerada e o ponto 1 fica preenchido`);
    const rolou = await p.evaluate(() => { const t = document.querySelector('#srTrack'); const w = t.firstElementChild.getBoundingClientRect().width; return Math.abs(t.scrollLeft - (w + 10)) < 4; });
    ok(rolou, `${nome}: a faixa de imagens rolou de verdade até a cena 2`);

    // navegar à mão: ponto, e setas no computador
    await p.click('[data-dot="3"]'); await p.waitForTimeout(700);
    ok(await p.evaluate(() => SESSION.slide === 3), `${nome}: tocar no ponto 4 mostra a cena 4`);
    if (!touch) {
      await p.click('#srNext'); await p.waitForTimeout(500);
      ok(await p.evaluate(() => SESSION.slide === 4), 'computador: seta › avança a cena');
      ok(await p.evaluate(() => document.querySelector('#srNext').disabled), 'computador: seta › desliga na última cena');
    } else {
      await p.evaluate(() => { const t = document.querySelector('#srTrack'); t.scrollTo({ left: 0, behavior: 'instant' }); });
      await p.waitForTimeout(400);
      ok(await p.evaluate(() => SESSION.slide === 0), 'celular: deslizar a faixa atualiza a cena atual');
    }

    // errado: troca as duas primeiras → legendas certas aparecem sobre as imagens, cenas erradas ficam em vermelho
    await p.evaluate(() => { SESSION.estado.montada = []; SESSION.render(document.querySelector('#view')); });
    const errado = await p.evaluate(() => {
      const r = SESSION.story.cenas.map(c => c.en); r.splice(0, 2, r[1], r[0]);
      SESSION.estado.montada = r.map(t => SESSION.pool.indexOf(t)); SESSION.confirmar();
      return { caps: document.querySelectorAll('.sr-cap').length, ruins: document.querySelectorAll('.sr-cap.ruim').length,
               erro: document.querySelectorAll('.sr-dot.erro').length, ok: document.querySelectorAll('.sr-dot.ok').length,
               cap0: document.querySelector('#srCap0').textContent, certo: SESSION.certo };
    });
    ok(!errado.certo && errado.caps === 5 && errado.ruins === 2 && errado.erro === 2 && errado.ok === 3, `${nome}: ordem errada marca 2 cenas em vermelho e 3 certas (${errado.ruins}/${errado.ok})`);
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => SESSION.slide === 0), `${nome}: ao confirmar errado o carrossel vai para a primeira cena fora do lugar`);
    ok(errado.cap0 === ilust[0].cenas[0].en, `${nome}: legenda certa da cena 1 aparece sobre a imagem 1`);
    ok(await p.evaluate(() => !document.querySelector('[data-bloco]:not([disabled])') ), `${nome}: depois de confirmar não dá mais para mexer nas frases`);

    // certo + progresso
    const certo = await p.evaluate(id => {
      const st = STORIES.find(x => x.id === id);
      SESSION = new StoryRebuildSession(); SESSION.story = st; SESSION.pool = embaralha(st.cenas.map(c => c.en)); document.querySelector('#view').innerHTML = ''; render();
      SESSION.estado.montada = st.cenas.map(c => SESSION.pool.indexOf(c.en)); SESSION.confirmar();
      const it = S.story.itens[id];
      return { certo: SESSION.certo, ok: document.querySelectorAll('.sr-dot.ok').length, conc: it.concluida, prim: it.acertouDePrimeira,
               ruins: document.querySelectorAll('.sr-cap.ruim').length };
    }, ilust[1].id);
    ok(certo.certo && certo.ok === 5 && certo.ruins === 0, `${nome}: ordem certa deixa os 5 pontos verdes`);
    ok(certo.conc && certo.prim, `${nome}: progresso do Story salvo por id (${ilust[1].id})`);
    await p.click('#continuar'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => /História remontada/.test(document.querySelector('#view').textContent)), `${nome}: tela final aparece`);

    const depois = await p.evaluate(() => JSON.stringify({ w: S.w, c: S.c, r: S.r, missao: S.missao }));
    ok(antes === depois, `${nome}: SRS e Missão do Dia intactos`);

    // história só de texto continua funcionando
    const so = await p.evaluate(() => {
      const st = STORIES.find(x => !storyTemImagens(x));
      SESSION = new StoryRebuildSession(); SESSION.story = st; SESSION.pool = embaralha(st.cenas.map(c => c.en)); SESSION._montado = false; render();
      SESSION.estado.montada = st.cenas.map(c => SESSION.pool.indexOf(c.en)); SESSION.confirmar();
      return { certo: SESSION.certo, carrossel: !!document.querySelector('#srCar') };
    });
    ok(so.certo && !so.carrossel, `${nome}: história sem imagem continua no modo texto`);

    // prioridade: o sorteio escolhe histórias ilustradas na maioria das vezes
    const prio = await p.evaluate(() => { S.story.hist = []; let n = 0; for (let i = 0; i < 400; i++) if (storyTemImagens(storyEscolher())) n++; return n; });
    ok(prio > 240 && prio < 400, `${nome}: histórias ilustradas saem com prioridade (${prio}/400), mas as de texto ainda aparecem`);
    await p.close();
  }
  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close(); process.exit(falhas ? 1 : 0);
})();
