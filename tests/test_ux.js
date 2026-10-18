// Redesign 17/10: navegação, céu de palavras e retorno visual — sem mexer no estado de estudo.
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };
  const errs = [];

  // ---------- computador ----------
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  await p.goto(APP); await p.waitForTimeout(400);
  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('home'); }, REAL);

  const nav = await p.evaluate(() => ({
    nomes: [...document.querySelectorAll('#tabbar button[data-t]')].filter(x => x.offsetWidth).map(x => x.textContent),
    mais: !!document.querySelector('#tabbar [data-mais]').offsetWidth,
    abasDeCima: !!document.querySelector('#tabs'),
    ind: !!document.querySelector('#tabbar .dock-ind'),
    reactor: TABS.some(t => t[0] === 'reactor') || typeof viewReactor !== 'undefined',
  }));
  ok(nav.nomes.join(',') === 'Início,Palavras,Frases,Academia,Leitura,Verbos,Calendário,Progresso,Dados', 'no computador o menu de baixo mostra todas as seções: ' + nav.nomes.join(', '));
  ok(!nav.mais, 'no computador não precisa do "Mais"');
  ok(!nav.abasDeCima, 'o menu de abas de cima saiu (o de baixo substitui, pedido dele 17/10)');
  ok(!nav.reactor, 'Reactor removido da navegação e do código (pedido dele, 17/10)');
  ok(nav.ind, 'indicador deslizante existe no menu');

  await p.click('#tabbar button[data-t="academia"]'); await p.waitForTimeout(700);
  const ind = await p.evaluate(() => {
    const a = document.querySelector('#tabbar button.on'), i = document.querySelector('#tabbar .dock-ind');
    return { ativo: a && a.dataset.t, largIgual: Math.abs(i.getBoundingClientRect().width - a.getBoundingClientRect().width) < 2,
             posIgual: Math.abs(i.getBoundingClientRect().left - a.getBoundingClientRect().left) < 2 };
  });
  ok(ind.ativo === 'academia' && ind.largIgual && ind.posIgual, 'indicador desliza e assenta exatamente sobre a seção ativa');

  // menu montado uma vez só (o indicador sobrevive entre telas — é isso que deixa ele deslizar)
  const mesmoNo = await p.evaluate(() => { const a = document.querySelector('#tabbar .dock-ind'); go('prog'); return a === document.querySelector('#tabbar .dock-ind'); });
  ok(mesmoNo, 'o menu não é recriado a cada tela');

  // céu de palavras
  const ceu = await p.evaluate(doc => { S = normaliza(unpack(doc)); go('home'); const c = document.querySelector('#ceu');
    return { existe: !!c, larg: c && c.width, alt: c && c.height, cols: CEU && CEU.cols, rows: CEU && CEU.rows }; }, REAL);
  ok(ceu.existe && ceu.larg > 0 && ceu.alt > 0, `céu de palavras desenhado na Home (${ceu.larg}x${ceu.alt})`);
  ok(ceu.cols * ceu.rows >= 3000, `grade do céu cabe as 3000 palavras (${ceu.cols} x ${ceu.rows})`);
  await p.waitForTimeout(1800);
  const box = await (await p.$('#ceu')).boundingBox();
  await p.mouse.move(box.x + 3, box.y + 3);
  await p.waitForTimeout(150);
  const tip = await p.evaluate(() => ({ on: document.querySelector('#ceuTip').classList.contains('on'), txt: document.querySelector('#ceuTip').textContent }));
  ok(tip.on && /be/.test(tip.txt) && /ser\/estar/.test(tip.txt), 'passar o cursor no primeiro ponto mostra a palavra: ' + tip.txt);
  await p.mouse.click(box.x + 3, box.y + 3); await p.waitForTimeout(250);
  ok(await p.evaluate(() => !!document.querySelector('.modal') && /ser\/estar/i.test(document.querySelector('.modal').textContent)), 'tocar no ponto abre a palavra');
  await p.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));

  // retorno visual: acerto solta faíscas, erro treme, nada disso toca o estado
  const fx = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    startMeaning();
    SESSION.responder(SESSION.d.opcoes.findIndex(o => o.ok));
    return { faiscas: document.querySelectorAll('#fx .faisca').length };
  }, REAL);
  ok(fx.faiscas > 0, `acerto solta faíscas (${fx.faiscas})`);
  await p.waitForTimeout(50);
  const treme = await p.evaluate(() => {
    startMeaning();
    const errada = SESSION.d.opcoes.findIndex(o => !o.ok);
    SESSION.responder(errada);
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(!!document.querySelector('#view .stage.treme')))));
  });
  ok(treme, 'erro faz o cartão tremer');

  // vibrar continua chamando a vibração do aparelho exatamente igual
  const vib = await p.evaluate(() => { const v = []; navigator.vibrate = x => { v.push(x); return true; }; vibrar(true); vibrar(false); return JSON.stringify(v); });
  ok(vib === '[18,[26,60,26]]', 'padrões de vibração intactos: ' + vib);

  // fim de sessão dispara confete uma vez
  const confete = await p.evaluate(() => new Promise(r => {
    document.querySelectorAll('#fx .confete').forEach(n => n.remove());
    SESSION = new StoryRebuildSession(); render();
    const resp = SESSION.story.cenas.map(c => c.en);
    SESSION.estado.montada = resp.map(t => SESSION.pool.indexOf(t)); SESSION.confirmar();
    SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view'));
    setTimeout(() => r(document.querySelectorAll('#fx .confete').length), 60);
  }));
  ok(confete > 20, `tela de fim solta confete (${confete} peças)`);

  // classe de sessão: some a navegação de baixo, abas ficam em segundo plano
  ok(await p.evaluate(() => document.body.classList.contains('em-sessao')), 'durante a sessão o corpo ganha "em-sessao"');
  ok(await p.evaluate(() => { go('home'); return !document.body.classList.contains('em-sessao'); }), 'ao sair, volta ao normal');
  await p.close();

  // ---------- celular ----------
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  m.on('pageerror', e => errs.push('PAGEERROR (cel): ' + e.message));
  await m.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
  await m.addInitScript(() => { window.claude = { use: async () => null }; });
  await m.goto(APP); await m.waitForTimeout(400);
  await m.evaluate(doc => { S = normaliza(unpack(doc)); go('home'); }, REAL);
  const cel = await m.evaluate(() => ({
    botoes: [...document.querySelectorAll('#tabbar button')].filter(x => x.offsetWidth).map(x => x.textContent.trim()),
    larguraOk: document.documentElement.scrollWidth <= 390,
  }));
  ok(cel.botoes.join(',') === 'Início,Palavras,Academia,Progresso,Mais', 'barra de baixo: ' + cel.botoes.join(', '));
  ok(cel.larguraOk, 'nada vaza na horizontal no celular');
  await m.tap('#tabbar [data-mais]'); await m.waitForTimeout(500);
  const folha = await m.evaluate(() => [...document.querySelectorAll('#sheet [data-tab]')].map(x => x.dataset.tab).join(','));
  ok(folha === 'frases,ler,verbos,cal,cfg', '"Mais" abre a folha com o resto das seções: ' + folha);
  await m.tap('#sheet [data-tab="cal"]'); await m.waitForTimeout(400);
  const foi = await m.evaluate(() => ({ tab: TAB, folha: !!document.querySelector('#sheet'), maisOn: document.querySelector('#tabbar [data-mais]').classList.contains('on') }));
  ok(foi.tab === 'cal' && !foi.folha && foi.maisOn, 'escolher na folha navega, fecha a folha e acende "Mais"');
  await m.tap('#tabbar [data-t="academia"]'); await m.waitForTimeout(300);
  ok(await m.evaluate(() => TAB === 'academia' && document.querySelector('#tabbar [data-t="academia"]').classList.contains('on')), 'tocar em Academia na barra de baixo navega e acende o ícone');
  const vaza = [];
  for (const t of ['home','bank','frases','academia','ler','verbos','cal','prog','cfg']) {
    const w = await m.evaluate(t => { go(t); return document.documentElement.scrollWidth; }, t);
    if (w > 392) vaza.push(`${t} (${w}px)`);
  }
  ok(!vaza.length, vaza.length ? 'telas vazando na horizontal no celular: ' + vaza.join(', ') : 'todas as 9 telas cabem na largura do celular');
  await m.close();

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
