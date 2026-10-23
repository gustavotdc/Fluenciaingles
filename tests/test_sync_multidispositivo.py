"""Teste de sincronização entre aparelhos (23/10): nenhum aparelho, novo ou com falha de rede, pode apagar a nuvem. Rodar: python3 tests/test_sync_multidispositivo.py (precisa de playwright + chromium)."""
import json, time, sys
from playwright.sync_api import sync_playwright
import os
URL="file://"+os.path.abspath(os.path.join(os.path.dirname(__file__),"../dist/index.html"))
remote={"row":None,"fail_get":False,"puts":[]}
def route(ctx):
    ctx.add_init_script("localStorage.setItem('fluencia_auth', JSON.stringify({access:'tok-teste',refresh:'r',exp:9999999999,email:'t@t'}))")
    # (fim init)
    def h(r):
        req=r.request
        if "supabase.co/rest" in req.url:
            if req.method=="GET":
                if remote["fail_get"]: return r.fulfill(status=500,body="x")
                rows=[{"dados":remote["row"]}] if remote["row"] else []
                return r.fulfill(status=200,content_type="application/json",body=json.dumps(rows))
            if req.method in("POST","PATCH"):
                d=json.loads(req.post_data)[0]["dados"]
                remote["row"]=d; remote["puts"].append(len(d.get("w",{})))
                return r.fulfill(status=201,body="")
            return r.fulfill(status=200,body="")
        r.continue_()
    ctx.route("**/*",h)
def nw(): return len((remote["row"] or {}).get("w",{}))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome") if False else p.chromium.launch()
    # A: device 1 learns 25 words
    c1=b.new_context(); route(c1); pg=c1.new_page();  pg.goto(URL); pg.wait_for_timeout(2500)
    pg.evaluate("()=>{for(let i=0;i<25;i++){const w=wd(i);w.l=Date.now();w.s=1;} save();}")
    pg.wait_for_timeout(2500); print("A remote words:",nw()); assert nw()==25
    # B: new device (empty local), GET ok
    c2=b.new_context(); route(c2); pg2=c2.new_page(); pg2.goto(URL); pg2.wait_for_timeout(3000)
    print("B"); assert pg2.evaluate("()=>Object.keys(S.w).length")==25 and nw()==25, "aparelho novo apagou a nuvem"
    # C: new device, GET FAILS then user acts
    remote["fail_get"]=True
    c3=b.new_context(); route(c3); pg3=c3.new_page(); pg3.goto(URL); pg3.wait_for_timeout(3000)
    pg3.evaluate("()=>{const w=wd(100);w.l=Date.now();w.s=1;save();}")
    pg3.wait_for_timeout(2500)
    print("C"); assert nw()==25, "falha de GET sobrescreveu a nuvem"
    # recovery: GET volta, C deve mesclar sem apagar
    remote["fail_get"]=False
    pg3.evaluate("()=>{const w=wd(101);w.l=Date.now();w.s=1;save();}"); pg3.wait_for_timeout(3000)
    assert nw()==27 and pg3.evaluate("()=>Object.keys(S.w).length")==27, "nao mesclou apos a rede voltar"
    # D: dois aparelhos aprendem palavras diferentes
    pg.evaluate("()=>{const w=wd(300);w.l=Date.now();w.s=2;w.a=3;save();}"); pg.wait_for_timeout(2500)
    pg2.evaluate("()=>{const w=wd(400);w.l=Date.now();w.s=1;save();}"); pg2.wait_for_timeout(2500)
    pg.bring_to_front(); pg.evaluate("()=>document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(2500)
    assert nw()==29 and pg.evaluate("()=>Object.keys(S.w).length")==29 and pg2.evaluate("()=>Object.keys(S.w).length")==29, "dois aparelhos nao convergiram"
    # E: dispositivo vazio nao apaga
    c5=b.new_context(); route(c5); pg5=c5.new_page(); pg5.goto(URL); pg5.wait_for_timeout(3000)
    assert pg5.evaluate("()=>Object.keys(S.w).length")==29 and nw()==29; print("OK: sync multi-aparelho (5 cenarios)")
    # F: tela de login (site https): sem sessão aparece; senha errada avisa; certa entra e usa o token
    seen={"auth":None}
    c6=b.new_context()
    def h6(r):
        q=r.request
        if q.url.startswith("https://app.test/"):
            return r.fulfill(status=200,content_type="text/html",body=open(os.path.join(os.path.dirname(__file__),"../dist/index.html"),encoding="utf-8").read())
        if "/auth/v1/token" in q.url:
            d=json.loads(q.post_data)
            if d.get("password")=="certa":
                return r.fulfill(status=200,content_type="application/json",body=json.dumps({"access_token":"tok-login","refresh_token":"rr","expires_in":3600,"user":{"email":d["email"]}}))
            return r.fulfill(status=400,content_type="application/json",body=json.dumps({"msg":"Invalid login credentials"}))
        if "supabase.co/rest" in q.url:
            seen["auth"]=q.headers.get("authorization")
            return r.fulfill(status=200,content_type="application/json",body="[]") if q.method=="GET" else r.fulfill(status=201,body="")
        r.continue_()
    c6.route("**/*",h6); pg6=c6.new_page(); pg6.goto("https://app.test/"); pg6.wait_for_timeout(1500)
    assert pg6.evaluate("()=>!!document.querySelector('#lgf')"), "tela de login nao apareceu"
    pg6.fill("#lge","a@a.com"); pg6.fill("#lgs","errada1"); pg6.click("#lgin"); pg6.wait_for_timeout(600)
    assert "incorretos" in pg6.inner_text("#lgm"), "nao avisou senha errada"
    pg6.fill("#lgs","certa1"); pg6.fill("#lgs","certa"); pg6.evaluate("()=>{document.querySelector('#lgs').removeAttribute('minlength')}"); pg6.click("#lgin"); pg6.wait_for_timeout(2500)
    assert not pg6.evaluate("()=>!!document.querySelector('#lgf')"), "login nao fechou"
    assert seen["auth"]=="Bearer tok-login", "sync nao usou o token do login: %s"%seen["auth"]
    print("OK: login (tela, senha errada, token usado no sync)")
    b.close()
