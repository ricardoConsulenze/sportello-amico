"""Genera la cartella documenti-demo/ per i tester di Sportello Amico.
Tutti i dati sono INVENTATI. Nessun documento reale.

  uv run --with pillow --with pypdf python documenti-demo/genera_documenti_demo.py
"""
import random
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from pypdf import PdfReader

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.dont_write_bytecode = True  # do not leave .pyc files outside documenti-demo/
sys.path.insert(0, str(ROOT))
import make_demo_docs as mdd  # noqa: E402  (riuso page(), font())

SRC = ROOT / "demo_docs"
STAMP = "FAC-SIMILE · DOCUMENTO DI PROVA"
CF = "XXXXXX00X00X000X"
NUM = "FAC000000"
font = mdd.font

COPIES = {
    "A_lucia_verbale_solo_pagina5.pdf": "01_lucia_verbale_INCOMPLETO_pag5di7.pdf",
    "C_verbale_completo_fittizio.pdf": "02_verbale_COMPLETO_3pagine.pdf",
    "B_giorgio_certificato_generico.png": "03_giorgio_certificato_SENZA_frase.png",
    "B2_giorgio_certificato_corretto.png": "04_giorgio_certificato_corretto_CON_frase.png",
    "C2_verbale_esempio_L382.pdf": "05_verbale_L382_non_vedente.pdf",
    "D_lucia_riepilogo_modulo.png": "06_lucia_riepilogo_modulo_CON_ERRORI.png",
}


def stamp(img, text=STAMP, fill=(200, 0, 0, 150)):
    """Diagonal watermark across the image."""
    w, h = img.size
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    f = font(max(18, w // 22), True)
    d = ImageDraw.Draw(layer)
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, h / 2 - w // 40), text, font=f, fill=fill)
    layer = layer.rotate(25, center=(w / 2, h / 2))
    out = Image.alpha_composite(img.convert("RGBA"), layer)
    return out.convert("RGB")


# ------------------------------------------------------------------ carta d'identità
def id_front(cognome, nome):
    img = Image.new("RGB", (1000, 640), "#eef1f6")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((4, 4, 995, 635), 30, outline="#1f3b70", width=6)
    d.rectangle((6, 6, 993, 96), fill="#1f3b70")
    d.text((30, 25), "CARTA D'IDENTITÀ · FAC-SIMILE", font=font(40, True), fill="white")
    d.rectangle((40, 130, 300, 460), fill="#c9d6e8", outline="#1f3b70", width=3)
    d.ellipse((110, 180, 230, 320), fill="#e8b48f")
    d.rectangle((90, 340, 250, 460), fill="#2e5c8a")
    rows = [f"Cognome: {cognome}", f"Nome: {nome}", "Nato il: 01/01/1950 a ESEMPIOPOLI",
            f"Cod. fiscale: {CF}", f"Documento n°: {NUM}", "Scadenza: 01/01/2099"]
    for i, t in enumerate(rows):
        d.text((340, 140 + i * 55), t, font=font(30), fill="#222")
    d.text((40, 560), "Comune di ESEMPIO · nessun valore legale", font=font(26, True), fill="#1f3b70")
    return stamp(img)


def id_back():
    img = Image.new("RGB", (1000, 640), "#eef1f6")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((4, 4, 995, 635), 30, outline="#1f3b70", width=6)
    rows = ["Cittadinanza: ESEMPIO", "Residenza: VIA DI PROVA 0, ESEMPIOPOLI", "Statura: 170   Colore occhi: ---",
            "Estremi atto di nascita: FAC-SIMILE", f"Cod. fiscale: {CF}"]
    for i, t in enumerate(rows):
        d.text((40, 60 + i * 55), t, font=font(30), fill="#222")
    d.rectangle((40, 400, 960, 600), fill="white", outline="#999")
    for i in range(3):
        d.text((55, 420 + i * 55), f"IDXXX<<{NUM}<<<<<<<<<<<<<<<<<<<<<<<"[:44], font=font(30), fill="#444")
    return stamp(img)


def on_table(card, cut=False):
    """Simulates a phone photo of the card on a table; cut=True leaves a corner out of frame."""
    bg = Image.new("RGB", (1280, 900), "#8a6e52")
    rot = card.rotate(-4, expand=True, fillcolor="#8a6e52")
    if cut:
        bg.paste(rot, (420, 330))  # bottom-right corner falls outside the frame
    else:
        bg.paste(rot, (110, 110))
    return bg


# ------------------------------------------------------------------ fototessera
def face(w=700, h=900, bg="#dbe8f5"):
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    cx = w // 2
    d.rectangle((cx - 230, h - 260, cx + 230, h), fill="#2e5c8a")          # shoulders
    d.rectangle((cx - 50, h - 340, cx + 50, h - 240), fill="#e2a982")        # neck
    d.ellipse((cx - 170, 170, cx + 170, 600), fill="#e8b48f")                # head
    d.chord((cx - 185, 140, cx + 185, 470), 180, 360, fill="#6b4a2f")        # hair
    for ex in (cx - 65, cx + 65):
        d.ellipse((ex - 18, 370, ex + 18, 395), fill="#3a2a1a")
    d.arc((cx - 60, 450, cx + 60, 530), 20, 160, fill="#a0522d", width=6)
    return img


def photo_ok():
    img = face()
    ImageDraw.Draw(img).text((20, 860), STAMP, font=font(24, True), fill=(200, 0, 0))
    return img


def photo_grey():
    img = ImageOps.grayscale(face()).convert("RGB")
    ImageDraw.Draw(img).text((20, 860), STAMP, font=font(24, True), fill=(60, 60, 60))  # grey: stays B/W
    return img


def photo_selfie():
    img = Image.new("RGB", (1200, 900), "#f3e6c8")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 1200, 300), fill="#9cc7e8")                    # window
    d.rectangle((60, 380, 330, 900), fill="#7a4f2a")                  # bookcase
    for y in range(400, 880, 70):
        d.rectangle((70, y, 320, y + 50), fill=random.choice(["#c0392b", "#27ae60", "#f1c40f", "#8e44ad"]))
    d.ellipse((880, 420, 1120, 700), fill="#4caf50")                  # plant
    f = face(520, 700, bg="#f3e6c8")
    img.paste(f.rotate(8, fillcolor="#f3e6c8"), (420, 200))
    d.text((20, 860), STAMP + " · selfie con sfondo", font=font(26, True), fill=(200, 0, 0))
    return img


# ------------------------------------------------------------------ PDF testuali
def pdf_pages(pages, name):
    imgs = [mdd.page(p, footer, stamp=STAMP) for p, footer in pages]
    imgs[0].save(HERE / name, save_all=True, append_images=imgs[1:], resolution=150)
    return imgs


def signature(img):
    d = ImageDraw.Draw(img)
    pts, x = [], 640
    random.seed(3)
    for i in range(40):
        x += 9
        pts.append((x, 1290 + 35 * ((-1) ** i) * random.random()))
    d.line(pts, fill="#123c8c", width=4, joint="curve")
    d.line((650, 1330, 1000, 1310), fill="#123c8c", width=3)
    return img


def delega(signed):
    lines = [("DELEGA PER LA RICHIESTA DEL PASS DISABILI (CUDE)", 32, True), ("---", 0, False),
             ("Io sottoscritta ANNA ESEMPIO, nata il 01/01/1950 a ESEMPIOPOLI,", 26, False),
             (f"codice fiscale {CF}, documento n° {NUM},", 26, False), ("", 20, False),
             ("DELEGO", 30, True), ("", 20, False),
             ("LUCIA ESEMPIO, nata il 01/01/1980 a ESEMPIOPOLI,", 26, False),
             (f"codice fiscale {CF}, documento n° {NUM},", 26, False),
             ("a presentare per mio conto la domanda di rilascio del contrassegno", 26, False),
             ("di parcheggio per persone con disabilità al Comune di Milano.", 26, False), ("", 20, False),
             ("Allego copia del mio documento d'identità.", 26, False), ("", 40, False),
             ("Milano, 01/10/2026", 26, False), ("", 40, False), ("", 40, False), ("", 40, False),
             ("Firma della persona delegante: ______________________", 26, False)]
    img = mdd.page(lines, stamp=STAMP)
    if signed:
        signature(img)
    return img


def nomina_pages():
    head = [("TRIBUNALE DI ESEMPIO · Ufficio del Giudice Tutelare (FAC-SIMILE)", 26, True), ("---", 0, False)]
    p1 = head + [("DECRETO DI NOMINA DI AMMINISTRATORE DI SOSTEGNO", 30, True), ("R.G. n. FAC000000", 24, False),
                 ("", 20, False), ("Il Giudice Tutelare,", 26, False),
                 ("letto il ricorso depositato in data 01/01/2026,", 26, False),
                 ("sentita la persona beneficiaria PERSONA ESEMPIO,", 26, False),
                 (f"nata il 01/01/1940 a ESEMPIOPOLI, C.F. {CF},", 26, False),
                 ("ritenuto che ricorrono i presupposti di legge (art. 404 c.c.),", 26, False), ("", 20, False),
                 ("NOMINA", 30, True),
                 ("amministratrice di sostegno SAMIRA ESEMPIO,", 26, False),
                 (f"nata il 01/01/1975 a ESEMPIOPOLI, C.F. {CF}.", 26, False), ("", 20, False),
                 ("(segue a pagina 2)", 24, False)]
    p2 = head + [("POTERI DELL'AMMINISTRATRICE DI SOSTEGNO", 30, True), ("", 20, False),
                 ("L'amministratrice è autorizzata a compiere in nome e per conto", 26, False),
                 ("della beneficiaria i seguenti atti:", 26, False),
                 ("- presentare domande a enti pubblici, compreso il Comune,", 26, False),
                 ("  per prestazioni e contrassegni (es. pass disabili);", 26, False),
                 ("- curare i rapporti con INPS e strutture sanitarie.", 26, False), ("", 20, False),
                 ("Durata: tempo indeterminato.", 26, False), ("", 40, False),
                 ("Esempiopoli, 15/01/2026", 26, False),
                 ("Il Giudice Tutelare: FIRMA DI PROVA", 26, False)]
    return [(p1, "Pagina 1 di 2"), (p2, "Pagina 2 di 2")]


# ------------------------------------------------------------------ riepilogo pulito
def riepilogo_ok():
    lines = [("8. Riepilogo  (simulazione del modulo Comune di Milano)", 32, True), ("---", 0, False),
             ("2. Dati richiedente", 26, True), ("Richiedo il pass disabili in qualità di: delegato", 24, False),
             ("3. Dati intestatario del pass disabili", 26, True),
             (f"Nome: ANNA   Cognome: ESEMPIO   Codice Fiscale: {CF}", 24, False),
             ("Telefono: 000 0000000   Email: esempio@example.com", 24, False),
             ("Documento di identità FRONTE: documento_titolare_fronte.jpg", 24, False),
             ("Documento di identità RETRO: documento_titolare_retro.jpg", 24, False),
             ("Fotografia 35x45: fototessera_35x45.jpg", 24, False),
             ("Delega firmata: delega_firmata.pdf", 24, False),
             ("Verbale: documento_sanitario.pdf", 24, False),
             ("4. Richiesta Pass", 26, True), ("Il/La sottoscritto/a chiede: il rilascio di un nuovo pass disabili", 24, False),
             ("5. Dichiarazioni integrative", 26, True), ("DICHIARA di conoscere e acconsentire: sì", 24, False),
             ("6. Modalità di ritiro del pass", 26, True),
             ("invio a domicilio con raccomandata", 24, False),
             ("7. Targa", 26, True), ("voler richiedere l'autorizzazione per il libero transito: sì", 24, False),
             ("TARGA: XX000XX", 24, False),
             ("Piattaforma nazionale CUDE: aderisco alla Piattaforma", 24, False)]
    return mdd.page(lines, stamp=STAMP)


# ------------------------------------------------------------------ verbale in foto
def verbale_photos():
    head = [("Centro Medico Legale di ESEMPIO", 26, False), ("", 20, False),
            ("VERBALE DI ACCERTAMENTO DELL'INVALIDITA' CIVILE", 30, True),
            ("(ai sensi dell'art. 20 della Legge 3 agosto 2009 n. 102)", 24, False), ("---", 0, False)]
    pages = [head + [("Data accertamento: 10/03/2025", 24, False),
                     (f"Nome: PERSONA ESEMPIO      C.F.: {CF}", 24, False),
                     ("Documentazione acquisita: OMISSIS", 24, False)],
             head + [("Diagnosi: OMISSIS", 24, False), ("---", 0, False),
                     ("Ricorrono le previsioni di cui:", 26, True), ("- all'art. 381 del DPR 495/1992", 26, False),
                     ("---", 0, False), ("ESONERO DA FUTURE VISITE DI REVISIONE: SI", 24, True)],
             head + [("Responsabile CML: OMISSIS", 24, False),
                     ("Firme autografe sostituite a mezzo stampa", 24, False)]]
    out = []
    for i, p in enumerate(pages, 1):
        img = mdd.page(p, f"Pagina {i} di 3", stamp=STAMP)
        img = img.resize((930, 1316))
        bg = Image.new("RGB", (1100, 1480), "#6d5843")       # photographed on a desk
        bg.paste(img.rotate(1.5 * (-1) ** i, expand=True, fillcolor="#6d5843"), (70, 60))
        out.append(bg)
    return out


def main():
    random.seed(1)
    for src, dst in COPIES.items():
        shutil.copyfile(SRC / src, HERE / dst)

    fa = id_front("ESEMPIO", "ANNA")
    on_table(fa).save(HERE / "10_anna_titolare_documento_FRONTE_ok.jpg", quality=88)
    on_table(id_back()).save(HERE / "11_anna_titolare_documento_RETRO_ok.jpg", quality=88)
    on_table(fa, cut=True).save(HERE / "12_anna_titolare_documento_FRONTE_TAGLIATO.jpg", quality=88)
    on_table(fa).filter(ImageFilter.GaussianBlur(9)).save(HERE / "13_anna_titolare_documento_FRONTE_SFOCATO.jpg", quality=88)
    fl = id_front("ESEMPIO", "LUCIA")
    on_table(fl).save(HERE / "14_lucia_richiedente_documento_FRONTE_ok.jpg", quality=88)
    on_table(id_back()).save(HERE / "15_lucia_richiedente_documento_RETRO_ok.jpg", quality=88)

    photo_ok().save(HERE / "20_fototessera_COLORI_ok.jpg", quality=90)
    photo_grey().save(HERE / "21_fototessera_BIANCO_NERO.jpg", quality=90)
    photo_selfie().save(HERE / "22_fototessera_SELFIE_con_sfondo.jpg", quality=88)

    delega(True).save(HERE / "30_delega_FIRMATA.pdf", resolution=150)
    delega(False).save(HERE / "31_delega_NON_firmata.pdf", resolution=150)

    nom = [mdd.page(p, f, stamp=STAMP) for p, f in nomina_pages()]
    nom[0].save(HERE / "40_samira_decreto_nomina_COMPLETO_2pagine.pdf", save_all=True, append_images=nom[1:], resolution=150)
    nom[1].save(HERE / "41_samira_decreto_nomina_SOLO_pagina2.pdf", resolution=150)

    # name must NOT contain "riepilogo": under MOCK=1 that word triggers the canned problems
    riepilogo_ok().save(HERE / "07_schermata_modulo_SENZA_errori.png")

    for i, img in enumerate(verbale_photos(), 1):
        img.save(HERE / f"50_verbale_foto_pag{i}di3.jpg", quality=85)

    # check
    bad = False
    for p in sorted(HERE.iterdir()):
        if p.suffix.lower() not in (".pdf", ".png", ".jpg"):
            continue
        size = p.stat().st_size
        if p.suffix == ".pdf":
            info = f"{len(PdfReader(p).pages)} pag."
        else:
            with Image.open(p) as im:
                im.verify()
            with Image.open(p) as im:
                info = f"{im.size[0]}x{im.size[1]} {im.mode}"
        ok = size < 5 * 1024 * 1024
        bad |= not ok
        print(f"{'OK ' if ok else 'TROPPO GRANDE'} {p.name:55s} {size / 1024:8.0f} KB  {info}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
