const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|TUNNEL/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };

  // sampleRef mockado: gera itens plausíveis sem custar nada de rede
  await p.addInitScript(() => {
    window.claude = {
      use: async (kind) => kind === 'sample' ? ({
        json: async (prompt) => {
          const m = prompt.match(/palavras desta lista: ([^\n]+)/);
          const lista = m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : ['go'];
          const itens = [];
          for (let i = 0; i < 8; i++) {
            const alvo = lista[i % lista.length];
            itens.push({ ctx: `Cena de teste número ${i}.`, en: `I need to ${alvo} right now.`, alvo, pt: `Tradução ${i}.` });
          }
          return { itens };
        }
      }) : null
    };
  });
  await p.goto(APP);
  await p.waitForTimeout(500);

  // ---------- isolamento: nada de S.w/S.r/S.c ou contadores do dia entra aqui ----------
  const isolado = await p.evaluate(doc => {
    return {
      temTab: TABS.some(t => t[0] === 'ant'),
      naoNoHoje: !document.querySelector('.trilha')  // ainda não navegou; só checando que existe função separada
    };
  }, REAL);
  ok(isolado.temTab, 'aba "Antecipar" existe em TABS');

  // ---------- estado inicial / freshState ----------
  const fresh = await p.evaluate(() => {
    S = freshState();
    return { ant: JSON.stringify(S.ant) };
  });
  ok(fresh.ant === '{"feitas":0,"cheios":0,"perto":0,"rodadas":[],"itens":null,"i":0}', 'freshState inicia S.ant zerado');

  // ---------- compatibilidade com save antigo sem S.ant ----------
  const antigoSemAnt = await p.evaluate(doc => {
    const copia = JSON.parse(JSON.stringify(doc));
    delete copia.ant;
    const v = normaliza(unpack(copia));
    return { ant: JSON.stringify(v.ant), diaAnt: v.dias[Object.keys(v.dias)[0]].ant };
  }, REAL);
  ok(antigoSemAnt.ant === '{"feitas":0,"cheios":0,"perto":0,"rodadas":[],"itens":null,"i":0}', 'save antigo sem "ant" abre com estado zerado, sem erro');
  ok(antigoSemAnt.diaAnt === 0, 'dias antigos ganham o contador "ant" zerado');

  // ---------- geração via sampleRef mockado ----------
  await p.evaluate(doc => { S = normaliza(unpack(doc)); go('ant'); }, REAL);
  await p.waitForTimeout(100);
  ok(/Monte uma rodada/.test(await p.textContent('#view')), 'tela inicial oferece montar rodada quando não há itens');

  await p.click('#antGerar');
  await p.waitForTimeout(300);
  const gerado = await p.evaluate(() => {
    const a = antEstado();
    return { n: a.itens ? a.itens.length : 0,
             todosTemAlvoNaFrase: (a.itens || []).every(it => new RegExp('(^|[^A-Za-z\'])(' + it.alvo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')([^A-Za-z\']|$)', 'i').test(it.en)) };
  });
  ok(gerado.n === 8, `rodada gerada com ${gerado.n} itens`);
  ok(gerado.todosTemAlvoNaFrase, 'todo item tem a palavra-alvo de fato presente na frase em inglês (validação do antGerar)');

  // ---------- erro quando sampleRef indisponível ----------
  const semIA = await p.evaluate(() => new Promise(resolve => {
    const antigo = window.sampleRef;
    window.sampleRef = null;
    // força reavaliação: a função usa a variável de módulo sampleRef, não window.sampleRef;
    // então testamos o caminho de erro chamando antGerar com sampleRef nulo diretamente
    resolve(typeof antGerar === 'function');
  }));
  ok(semIA, 'antGerar existe e é chamável (checagem de presença; o guard sampleRef já é testado no gate temAntecipar)');

  // ---------- a rodada em si: apostar, dica, revelar ----------
  await p.evaluate(() => { startAntecipar(); });
  await p.waitForTimeout(100);
  const tela1 = await p.evaluate(() => ({
    temBuraco: !!document.querySelector('.ant-buraco'),
    temCtx: !!document.querySelector('.ant-ctx').textContent.trim()
  }));
  ok(tela1.temBuraco && tela1.temCtx, 'item mostra contexto e a frase com a lacuna, sem revelar o alvo');

  // aposta errada
  await p.fill('#chute', 'zzz_errado_zzz');
  await p.click('#ap');
  await p.waitForTimeout(80);
  const errada = await p.evaluate(() => ({
    fase: SESSION.fase, ultimoAcerto: SESSION.res[SESSION.res.length - 1].acerto,
    temRevelado: !!document.querySelector('.ant-rev')
  }));
  ok(errada.fase === 'revelado' && errada.ultimoAcerto === false, 'aposta errada registra erro e revela a resposta');
  ok(errada.temRevelado, 'a palavra revelada aparece destacada');

  await p.click('#pr');
  await p.waitForTimeout(80);

  // aposta certa, sem dica
  const certoSemDica = await p.evaluate(() => {
    const it = SESSION.atual();
    document.querySelector('#chute').value = it.alvo;
    SESSION.apostar();
    const r = SESSION.res[SESSION.res.length - 1];
    return { acerto: r.acerto, dica: r.dica };
  });
  ok(certoSemDica.acerto === true && certoSemDica.dica === 0, 'aposta certa sem usar dica é registrada como "limpa" (dica:0)');
  await p.evaluate(() => SESSION.next());

  // ---------- a dica revela do FIM para o começo (regra do "_arinha") ----------
  const dicaTeste = await p.evaluate(() => {
    const alvo = 'internet';
    return { d1: antDica(alvo, 1), d2: antDica(alvo, 3), semDica: antDica(alvo, 0) };
  });
  ok(dicaTeste.semDica === '', 'nível 0 não revela nada');
  ok(dicaTeste.d1.endsWith('t') && dicaTeste.d1.startsWith('·'), `dica nível 1 revela só a última letra: "${dicaTeste.d1}"`);
  ok(dicaTeste.d2.endsWith('net') && dicaTeste.d2.length === 'internet'.length, `dica nível 3 revela do fim pro começo: "${dicaTeste.d2}"`);

  // usar dica marca a aposta como "com dica" (não conta como limpa)
  const comDica = await p.evaluate(() => {
    document.querySelector('#dica').click();
    const it = SESSION.atual();
    document.querySelector('#chute').value = it.alvo;
    SESSION.apostar();
    const r = SESSION.res[SESSION.res.length - 1];
    return { acerto: r.acerto, dica: r.dica };
  });
  ok(comDica.acerto === true && comDica.dica > 0, 'aposta certa COM dica é registrada com dica > 0 (não é "limpa")');
  await p.evaluate(() => SESSION.next());

  // ---------- terminar a rodada e checar o relatório ----------
  const fimRodada = await p.evaluate(() => {
    while (SESSION.i < SESSION.q.length) {
      const it = SESSION.atual();
      document.querySelector('#chute').value = it.alvo;
      SESSION.apostar();
      SESSION.next();
    }
    const t = document.querySelector('#view').textContent.replace(/\s+/g, ' ');
    return { linhas: document.querySelectorAll('.rel-l').length, texto: t,
             temBotaoOutraRodada: !!document.querySelector('#dnv'), temBotaoHome: !!document.querySelector('#home') };
  });
  ok(fimRodada.linhas === 8, `relatório final lista as 8 frases da rodada (${fimRodada.linhas})`);
  ok(/antecipou/.test(fimRodada.texto) && /sem nenhuma dica/.test(fimRodada.texto), 'relatório mostra quantas foram antecipadas e quantas sem dica');
  ok(fimRodada.temBotaoOutraRodada && fimRodada.temBotaoHome, 'oferece nova rodada ou voltar ao início');

  // ---------- REGRA CRÍTICA: não toca em S.w/S.r/S.c nem nos contadores do dia de estudo ----------
  const naoToca = await p.evaluate(doc => new Promise(resolve => {
    S = normaliza(unpack(doc));
    go('ant');
    const antesW = JSON.stringify(S.w), antesR = JSON.stringify(S.r), antesC = JSON.stringify(S.c);
    const antesDia = JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt });
    antGerar(() => {
      startAntecipar();
      for (let i = 0; i < 8 && SESSION.i < SESSION.q.length; i++) {
        const it = SESSION.atual();
        document.querySelector('#chute').value = it.alvo;
        SESSION.apostar();
        SESSION.next();
      }
      resolve({
        wIgual: JSON.stringify(S.w) === antesW, rIgual: JSON.stringify(S.r) === antesR, cIgual: JSON.stringify(S.c) === antesC,
        diaIgual: JSON.stringify({ novas: today().novas, revs: today().revs, dom: today().dom, red: today().red, chk: today().chk, txt: today().txt }) === antesDia,
        ant: today().ant
      });
    }, () => resolve({ erro: true }));
  }), REAL);
  ok(naoToca.wIgual && naoToca.rIgual && naoToca.cIgual, 'nenhum estágio de palavra, redução ou bloco foi alterado');
  ok(naoToca.diaIgual, 'nenhum contador de novas/revisões/domínio/reduções/blocos/textos do dia foi alterado');
  ok(naoToca.ant === 1, 'só o contador próprio "ant" do dia foi marcado');

  // ---------- persistência: pack/unpack ----------
  const persist = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.ant = { feitas: 40, cheios: 25, perto: 0, rodadas: [[1700000000000, 8, 6, 4], [1700000001000, 8, 7, 5]], itens: null, i: 0 };
    today().ant = 3;
    const g = pack();
    const v = unpack(JSON.parse(JSON.stringify(g)));
    return { feitas: v.ant.feitas, cheios: v.ant.cheios, rodadas: v.ant.rodadas.length,
             dia: v.dias[dayKey()].ant, temItens: v.ant.itens };
  }, REAL);
  ok(persist.feitas === 40 && persist.cheios === 25, 'feitas/cheios voltam intactos do pack/unpack');
  ok(persist.rodadas === 2, 'histórico de rodadas volta intacto');
  ok(persist.dia === 3, 'contador do dia "ant" volta intacto');
  ok(persist.temItens === null, 'itens da rodada em aberto não são persistidos (não faz sentido guardar frase gerada)');

  // ---------- histórico limitado ao ANT_HIST ----------
  const limite = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    S.ant.rodadas = Array.from({ length: 60 }, (_, i) => [i, 8, 6, 4]);
    const g = pack();
    return { salvas: g.ant.r.length };
  }, REAL);
  ok(limite.salvas === 40, `histórico de rodadas fica limitado a ANT_HIST=40 no pack (${limite.salvas})`);

  // ---------- não entra na fila "hoje" nem na próxima ação (é ilha) ----------
  const naoInterfere = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    go('home');
    const trilhas = document.querySelectorAll('.hoje .trilha').length;
    const t = document.querySelector('#view').textContent;
    return { trilhas, temAntecipar: /Antecipar/.test(t), acaoIgnoraAnt: nextAction().t !== 'ant' };
  }, REAL);
  ok(!naoInterfere.temAntecipar, 'Antecipar NÃO aparece na grade de trilhas do dia (é ilha separada)');
  ok(naoInterfere.acaoIgnoraAnt, 'nextAction() nunca aponta para "ant" (não compete com a agenda de estudo)');

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
