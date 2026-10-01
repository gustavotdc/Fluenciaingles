import json, os
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "src", "app_template.html")
XLSX = os.path.join(ROOT, "data", "05-level1-1200-palavras.xlsx")
OUT_DIR = os.path.join(ROOT, "dist")

# ---- palavras ----
# fonte única: a planilha. A coluna PAV (r[4]) já traz o texto certo tanto
# para as 1200 originais quanto para as 1800 novas (bloco 49-120).
wb = openpyxl.load_workbook(XLSX)
ws = wb["Level 1"]
rows = list(ws.iter_rows(min_row=2, values_only=True))

W = []
for r in rows:
    if r[0] is None:
        continue
    W.append([str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5]), int(r[6])])
assert len(W) == 3000, len(W)
assert all(x[3] for x in W)
ens = [x[2].strip().lower() for x in W]
assert len(ens) == len(set(ens)), "palavra em inglês duplicada na planilha"


def load(path, n):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("|")
            assert len(parts) == n, (path, line)
            out.append(parts)
    return out


FAM = json.load(open(os.path.join(ROOT, "data", "familias.json")))
R = load(os.path.join(ROOT, "data", "reducoes.txt"), 5)
C = load(os.path.join(ROOT, "data", "chunks.txt"), 4)


def load_json_opt(path):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []


TXT_BANCO = load_json_opt(os.path.join(ROOT, "data", "txt_banco.json"))
ANT_BANCO = load_json_opt(os.path.join(ROOT, "data", "ant_banco.json"))
VERBOS = load_json_opt(os.path.join(ROOT, "data", "verbos.json"))

print("palavras", len(W), "| reducoes", len(R), "| blocos", len(C), "| familias", len(FAM),
      "| textos prontos", len(TXT_BANCO), "| antecipar prontos", len(ANT_BANCO),
      "| verbos prontos", len(VERBOS))

tpl = open(TPL, encoding="utf-8").read()
html = (tpl
        .replace("/*__WORDS__*/[]", json.dumps(W, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__RED__*/[]", json.dumps(R, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__CHK__*/[]", json.dumps(C, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__FAM__*/{}", json.dumps(FAM, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__TXTBANCO__*/[]", json.dumps(TXT_BANCO, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__ANTBANCO__*/[]", json.dumps(ANT_BANCO, ensure_ascii=False, separators=(",", ":")))
        .replace("/*__VERBOS__*/[]", json.dumps(VERBOS, ensure_ascii=False, separators=(",", ":"))))
assert not any(m in html for m in ("__WORDS__", "__RED__", "__CHK__", "__FAM__", "__TXTBANCO__", "__ANTBANCO__", "__VERBOS__"))

os.makedirs(OUT_DIR, exist_ok=True)
open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8").write(html)
print("ok ->", os.path.join(OUT_DIR, "index.html"))
