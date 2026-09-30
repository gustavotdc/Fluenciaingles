const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await p.addInitScript(() => {
    const v=[{name:'Fake',lang:'en-US',localService:true}];
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>v,speak(){},cancel(){},resume(){},paused:false,speaking:false,pending:false},configurable:true,writable:true});
  });
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html'));
  await p.waitForTimeout(600);
  const ok=(c,m)=>console.log((c?'OK   ':'FALHA')+'  '+m);

  // todos os modos de revisao de reducao e bloco
  for (const k of ['red','chk']) {
    for (const s of [0,1,2,3,4,5,6,7]) {
      const r = await p.evaluate(([k,s]) => {
        S = freshState(); S.frasesDesde = dayKey();
        const x = fd(k,0); x.l = Date.now()-1000; x.s = s; x.n = Date.now()-1000;
        startFrases(k);
        const frente = $('.stage').textContent.replace(/\s+/g,' ').trim();
        SESSION.revealed = true; SESSION.render($('#view'));
        const verso = $('.stage').textContent.replace(/\s+/g,' ').trim();
        const modo = fModo(k, Math.min(8,s+1));
        return {modo, frente:frente.slice(0,60), verso:verso.slice(0,80), temBotoes: !!$('#ok')};
      }, [k,s]);
      ok(r.frente.length>10 && r.verso.length>10 && r.temBotoes, `${k} s=${s} [${r.modo}] frente="${r.frente}"`);
    }
  }
  // revisao conta e avanca o estagio
  const av = await p.evaluate(() => {
    S = freshState(); S.frasesDesde = dayKey();
    const x = fd('chk',0); x.l = Date.now()-1000; x.s = 3; x.n = Date.now()-1000;
    startFrases('chk'); SESSION.revealed = true; SESSION.answer(true);
    const y = S.c[0];
    return {s:y.s, n:!!y.n, chkDia:S.dias[dayKey()].chk};
  });
  ok(av.s===4 && av.n && av.chkDia===0, 'revisao avanca estagio sem contar como novo: '+JSON.stringify(av));

  // erro na revisao volta amanha sem regredir
  const er = await p.evaluate(() => {
    S = freshState(); S.frasesDesde = dayKey();
    const x = fd('red',0); x.l = Date.now()-1000; x.s = 4; x.n = Date.now()-1000;
    startFrases('red'); SESSION.revealed = true; SESSION.answer(false);
    const y = S.r[0];
    return {s:y.s, e:y.e, amanha: new Date(y.n).getDate() !== new Date().getDate()};
  });
  ok(er.s===4 && er.e===1 && er.amanha, 'erro: estagio mantido, volta amanha: '+JSON.stringify(er));

  // aba Frases com lista e filtro de grupo
  await p.evaluate(() => { S = freshState(); S.frasesDesde = dayKey(); frasesTab='chk'; go('frases'); });
  await p.waitForTimeout(200);
  const linhas = await p.$$eval('#flist .wrow', r => r.length);
  const grupos = await p.$$eval('#ffgs option', o => o.length);
  ok(linhas===60 && grupos===14, `lista de blocos: ${linhas} linhas, ${grupos} opcoes de grupo`);
  await p.click('#flist .wrow'); await p.waitForTimeout(150);
  ok(!!(await p.$('.modal')), 'modal de detalhe abre');
  await p.click('.modal #x'); await p.waitForTimeout(100);

  await p.evaluate(() => { frasesTab='red'; render(); });
  await p.waitForTimeout(200);
  const lr = await p.$$eval('#flist .wrow', r => r.length);
  ok(lr===60, 'lista de reducoes: '+lr);
  await p.click('#flist .wrow'); await p.waitForTimeout(150);
  const txt = await p.textContent('.modal');
  ok(/regra|A regra/i.test(txt), 'modal da reducao mostra a regra');

  console.log(errs.length ? '\nERROS:\n'+errs.join('\n') : '\nSem erros de console.');
  await b.close();
})();
