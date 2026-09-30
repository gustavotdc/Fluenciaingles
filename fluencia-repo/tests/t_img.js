const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA') + '  ' + m);
  await p.addInitScript(() => {
    window.__assets = new Map(); let n = 0;
    window.claude = { use: async k => k === 'assets' ? {
      upload: async (blob, o) => { const id = ('a'+(++n)).padEnd(32,'0'); window.__assets.set(id,{sizeBytes:blob.size,contentType:o.type}); return {id,url:'/_blob/'+id,sizeBytes:blob.size,contentType:o.type}; },
      list: async () => ({assets:[],usage:{files:0,bytes:0,maxFiles:9,maxBytes:9}}),
      delete: async id => ({deleted: window.__assets.delete(id)})
    } : null };
    // intercepta o seletor de arquivo: simula o usuario escolhendo uma foto
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function(){
      if(this.type !== 'file') return orig.apply(this, arguments);
      const c = document.createElement('canvas'); c.width=1600; c.height=900;
      c.getContext('2d').fillRect(0,0,1600,900);
      c.toBlob(bl => {
        const f = new File([bl], 'cena.png', {type:'image/png'});
        const dt = new DataTransfer(); dt.items.add(f);
        this.files = dt.files;
        this.onchange && this.onchange();
      }, 'image/png');
    };
  });
  await p.route('**/_blob/**', r => r.fulfill({status:200,contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==','base64')}));
  await p.goto('file://' + require('path').resolve(__dirname, '../dist/index.html'));
  await p.waitForTimeout(700);

  await p.evaluate(() => go('bank'));
  await p.waitForTimeout(300);
  ok(/Clique numa palavra/.test(await p.textContent('#view')), 'o banco explica onde se envia a imagem');

  await p.click('#list .wrow');
  await p.waitForTimeout(250);
  ok(!!(await p.$('#imgTrocar')), 'botao "enviar imagem" visivel direto no modal da palavra');
  ok(/Imagem da cena/.test(await p.textContent('.card')), 'secao de imagem aparece no modal');

  await p.click('#imgTrocar');
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({ id: imgOf(0), n: window.__assets.size, img: !!document.querySelector('.card .pavimg img'), botoes: [!!document.querySelector('#imgTrocar'), !!document.querySelector('#imgTirar')] }));
  ok(!!r.id && r.n === 1, 'imagem enviada pelo banco e vinculada: ' + r.id);
  ok(r.img, 'modal reabre ja mostrando a imagem');
  ok(r.botoes[0] && r.botoes[1], 'aparecem "trocar" e "remover" depois de enviar');

  const cont = await p.evaluate(() => { go('bank'); return $('#view').textContent; });
  ok(/1 com imagem/.test(cont), 'o banco conta as palavras com imagem');

  console.log(errs.length ? '\nERROS:\n'+errs.join('\n') : '\nSem erros de console.');
  await b.close(); process.exit(0);
})();
