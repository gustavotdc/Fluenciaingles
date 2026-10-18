// Treino completo do verbo (17/10): formas, usos com exemplos, tempos e prática gerada do conteúdo.
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '../dist/index.html');
const REAL = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/estado_exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.route(/googleapis|gstatic|supabase|accounts\.google/, r => r.abort());
  await p.addInitScript(() => { window.claude = { use: async () => null }; });
  let falhas = 0;
  const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA') + '  ' + m); };
  await p.goto(APP); await p.waitForTimeout(400);

  // ---------- banco ----------
  const banco = await p.evaluate(() => {
    const ids = VERBOS.map(v => v.id), modais = VERBOS.filter(v => v.modal).map(v => v.id);
    let semFormas = [], poucos = [], alvoFora = [], formasFaltando = [];
    VERB_USOS.forEach(vu => {
      const n = vu.usos.reduce((a, u) => a + u.exemplos.length, 0);
      const modal = modais.includes(vu.id);
      if (n < (modal ? 6 : 8)) poucos.push(vu.id);
      const usadas = new Set();
      vu.usos.forEach(u => u.exemplos.forEach(e => { usadas.add(e.forma); if (!reAlvo(e.alvo).test(e.en)) alvoFora.push(vu.id + ': ' + e.en); }));
      if (!modal && ['base','s','ing','passado','participio'].some(k => !usadas.has(k))) formasFaltando.push(vu.id);
    });
    return { n: VERB_USOS.length, cobre: ids.every(id => verbUsos(id)), poucos, alvoFora, formasFaltando,
             exemplos: VERB_USOS.reduce((a, vu) => a + vu.usos.reduce((x, u) => x + u.exemplos.length, 0), 0) };
  });
  ok(banco.n === 80 && banco.cobre, `os 80 verbos têm formas e usos (${banco.exemplos} exemplos no total)`);
  ok(!banco.poucos.length, 'cada verbo tem exemplos suficientes ' + banco.poucos.join(','));
  ok(!banco.alvoFora.length, 'a forma marcada aparece de verdade em toda frase ' + banco.alvoFora.slice(0, 3).join(' | '));
  ok(!banco.formasFaltando.length, 'todo verbo comum usa as 5 formas (base, -s, -ing, passado, particípio) nos exemplos ' + banco.formasFaltando.join(','));

  // ---------- formas do GET ----------
  const formas = await p.evaluate(doc => {
    S = normaliza(unpack(doc)); startVerbStudy('get');
    const tiles = [...document.querySelectorAll('[data-forma] b')].map(x => x.textContent);
    document.querySelector('[data-forma="passado"]').click();
    const frase = document.querySelector('.vb-ex-forma').textContent;
    return { tiles, frase, marcado: document.querySelector('.vb-ex-forma mark') && document.querySelector('.vb-ex-forma mark').textContent };
  }, REAL);
  ok(formas.tiles.join(',') === 'get,gets,getting,got,gotten', 'GET mostra todas as formas: ' + formas.tiles.join(' · '));
  ok(formas.marcado && formas.marcado.toLowerCase() === 'got', 'tocar em "passado" mostra uma frase com "got" destacado: ' + formas.frase.trim().slice(0, 60));

  const modal = await p.evaluate(() => { startVerbStudy('can'); return [...document.querySelectorAll('[data-forma] b')].map(x => x.textContent).join(','); });
  ok(modal === "can,can't", 'modal mostra afirmativa e negativa: ' + modal);
  const be = await p.evaluate(() => { startVerbStudy('be'); return [...document.querySelectorAll('[data-forma] b')].map(x => x.textContent).join(' | '); });
  ok(be === 'be | am · is · are | being | was · were | been', 'BE mostra presente e passado completos: ' + be);

  // ---------- usos e tempos ----------
  const usos = await p.evaluate(() => {
    startVerbStudy('get');
    document.querySelector('#nx').click();
    const n = SESSION.vu.usos.length, vistos = [];
    for (let i = 0; i < n; i++) { vistos.push(document.querySelector('.vb-sentido').textContent + ':' + document.querySelectorAll('.vb-ex').length); document.querySelector('#nx').click(); }
    return { n, vistos, fase: SESSION.fase, tempos: document.querySelectorAll('.vb-ex').length };
  });
  ok(usos.n >= 5 && usos.vistos.every(x => +x.split(':').pop() >= 2), `GET passa por ${usos.n} usos, cada um com 2+ exemplos`);
  ok(usos.fase === 'tempos' && usos.tempos === 6, 'depois dos usos vem a tela com os 6 tempos (conteúdo antigo preservado)');

  // ---------- prática ----------
  const pr = await p.evaluate(() => {
    document.querySelector('#nx').click();
    const tipos = SESSION.pratica.map(q => q.tipo);
    const q0 = SESSION.pratica[0];
    const opcoesUnicas = new Set(q0.opcoes.map(o => o.toLowerCase())).size === q0.opcoes.length;
    const temCerta = q0.opcoes.includes(q0.certa);
    const lacunaVisivel = !!document.querySelector('.lacuna') && !document.querySelector('.vb-frase.grande').textContent.toLowerCase().includes(' ' + q0.certa.toLowerCase() + ' ');
    return { tipos, opcoesUnicas, temCerta, lacunaVisivel, ptVisivel: !!document.querySelector('.vb-pt') };
  });
  ok(pr.tipos.filter(t => t === 'lacuna').length === 3 && pr.tipos.includes('sentido') && pr.tipos.includes('montar'), 'prática mistura completar, sentido e montar: ' + pr.tipos.join(','));
  ok(pr.opcoesUnicas && pr.temCerta, 'opções da lacuna sem repetição e com a resposta certa');
  ok(pr.lacunaVisivel && pr.ptVisivel, 'a frase aparece com a lacuna e a tradução embaixo (tira a ambiguidade de tempo)');

  const resp = await p.evaluate(() => {
    const out = [];
    for (let i = 0; i < SESSION.pratica.length; i++) {
      const q = SESSION.pratica[SESSION.q];
      if (q.tipo === 'montar') {
        const usados = new Set();
        q.estado.montada = q.blocos.map(t => { const ix = q.pool.findIndex((x, j) => x === t && !usados.has(j)); usados.add(ix); return ix; });
        SESSION.render(document.querySelector('#view'));
        document.querySelector('#confirmar').click();
      } else {
        const certa = SESSION.q === 0 ? q.opcoes.findIndex(o => o !== q.certa) : q.opcoes.indexOf(q.certa);   // erra a primeira de propósito
        document.querySelector(`[data-op="${certa}"]`).click();
      }
      out.push(SESSION.pratica[SESSION.q].ok);
      document.querySelector('#nx').click();
    }
    return { out, acertos: SESSION.acertos, fase: SESSION.fase, txt: document.querySelector('#view').textContent.replace(/\s+/g, ' ') };
  });
  ok(resp.out[0] === false && resp.out.slice(1).every(Boolean), 'resposta errada conta como erro, certas como acerto: ' + resp.out.join(','));
  ok(resp.fase === 'fim' && new RegExp(`Prática: ${resp.acertos} de ${resp.out.length}`).test(resp.txt), 'fim mostra o placar da prática: ' + (resp.txt.match(/Prática: \d+ de \d+/) || [''])[0]);

  // ---------- progresso: igual ao de antes ----------
  const prog = await p.evaluate(doc => {
    S = normaliza(unpack(doc));
    const antesDia = today().verb || 0, antesW = JSON.stringify(S.w);
    const antes = verbProgresso('get').slice();
    startVerbStudy('get'); SESSION.fase = 'fim'; SESSION.render(document.querySelector('#view')); SESSION.render(document.querySelector('#view'));
    const depois = verbProgresso('get');
    return { conta: (today().verb || 0) - antesDia, sobe: depois.every((x, i) => x === Math.min(100, antes[i] + 14)), wIgual: JSON.stringify(S.w) === antesW };
  }, REAL);
  ok(prog.conta === 1, 'concluir conta 1 verbo na meta do dia (mesmo se a tela de fim redesenhar)');
  ok(prog.sobe, 'domínio de cada componente sobe +14, igual ao fluxo antigo, uma vez só');
  ok(prog.wIgual, 'o treino de verbo não toca no vocabulário (S.w)');

  const sair = await p.evaluate(() => { startVerbStudy('make'); return !!document.querySelector('#sair'); });
  ok(sair, 'tem como sair no meio');
  const lista = await p.evaluate(() => { go('verbos'); const c = document.querySelector('[data-v="get"] .vb-mini'); return c && c.textContent; });
  ok(lista === 'get · gets · getting · got · gotten', 'a lista de verbos mostra as formas de cada um: ' + lista);

  console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nSem erros de console.');
  console.log(falhas ? '\n>>> ' + falhas + ' FALHA(S)' : '\n>>> tudo passou');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
