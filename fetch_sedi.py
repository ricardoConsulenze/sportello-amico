"""Download once the City offices from the Comune di Milano open data portal and save them in
knowledge/sedi.json. The server reads only that file: no network calls at runtime.

Run it again only to refresh the data (the date of the download is saved in the file).

  python fetch_sedi.py
"""
import csv
import io
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

OUT = Path(__file__).parent / "knowledge" / "sedi.json"
API = "https://dati.comune.milano.it/api/3/action/package_show?id="
PAGE = "https://www.comune.milano.it/servizi/mobilita/pass-per-la-sosta-e-la-circolazione-di-persone-con-disabilita"

# slug -> (tipo, what it is for in this assistant, warning shown with the data)
DATASETS = {
    "ds549-sedi-dei-servizi-anagrafici":
        ("anagrafe", "Documento d'identità e CIE del titolare o del richiedente.", ""),
    "ds1303-servizio-sociale-professionale-territoriale-le-sedi":
        ("servizio_sociale", "Aiuto per chi non riesce a fare la domanda da solo.", ""),
    "ds550_sede-dei-sindacati-e-patronati":
        ("patronato", "Assistenza su verbale d'invalidità INPS e visite di revisione.",
         "Elenco del 2018 (hackathon Service4Migrants): verificare i recapiti prima di indicarli."),
    "ds1299-sedi-municipi-nel-comune-di-milano":
        ("municipio", "Sede e contatti del Municipio dell'utente.", ""),
    "ds535_atm-fermate-linee-metropolitane":
        ("metro", "Fermata della metropolitana più vicina a una sede.",
         "Non contiene informazioni sull'accessibilità delle stazioni (ascensori, scale mobili): vedi atm.it."),
}


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def read_csv(raw: bytes) -> list[dict]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return [{k.strip(): (v or "").strip() for k, v in row.items() if k}
            for row in csv.DictReader(io.StringIO(text), delimiter=";")]


def coord(value: str) -> float | None:
    try:
        return round(float(value), 6)
    except ValueError:
        return None


def municipio(value: str) -> str:
    digits = "".join(c for c in value.split("-")[0] if c.isdigit())
    return digits or ""


def sede(tipo: str, row: dict) -> dict:
    """One office in a common shape. Empty fields are dropped."""
    if tipo == "anagrafe":
        s = {"nome": f"Anagrafe {row['titolo'] or row['NIL'].title()}", "indirizzo": row["Indirizzo"], "telefono": row["telefono"],
             "orari": row["orari"], "note": row["Note"], "municipio": municipio(row["titolo"])}
    elif tipo == "servizio_sociale":
        s = {"nome": f"Servizio Sociale {row['Sedi Servizio Sociale Professionale Territoriale']}",
             "indirizzo": f"{row['Indirizzo']} {row['Civico']}".strip(), "telefono": row["Telefono"],
             "orari": row["Orari"], "note": "; ".join(x for x in (row["Piano"], row["Note"]) if x and x != "n.d."),
             "municipio": row["MUNICIPIO"], "link": row["link utili"]}
    elif tipo == "patronato":
        s = {"nome": row["Patronati"], "indirizzo": row["Indirizzo"].title(), "telefono": row["tel"],
             "municipio": row["MUNICIPIO"], "link": row["indirizzo web"]}
    elif tipo == "municipio":
        s = {"nome": row["Municipio"], "indirizzo": f"{row['Indirizzo']} {row['Civico']}, {row['CAP']}",
             "telefono": row["telefono"], "email": row["indirizzo mail istituzionale"],
             "mezzi_pubblici": row["Mezzi pubblici"], "municipio": municipio(row["Municipio"])}
    else:  # metro
        name = re.sub(r"\s+M\d$", "", row["nome"].title())  # "Loreto M1" -> "Loreto": the line is in "linee"
        s = {"nome": name, "linee": "M" + row["linee"].replace(",", ", M")}
    s["quartiere"] = row.get("NIL", "").title()
    s["lat"], s["lon"] = coord(row.get("LAT_Y_4326", "")), coord(row.get("LONG_X_4326", ""))
    return {k: v for k, v in s.items() if v not in ("", None, "n.d.")}


def drop_shared_coords(rows: list[dict]) -> list[str]:
    """The same point for different addresses is a copy error in the dataset (e.g. ds1303, via Anfossi
    placed in Bruzzano). We cannot tell which one is right, so all of them lose their coordinates:
    better no distance than a wrong one."""
    seen: dict[tuple, set] = {}
    for r in rows:
        if r.get("lat") is not None and "indirizzo" in r:
            seen.setdefault((r["lat"], r["lon"]), set()).add(r["indirizzo"].lower())
    shared = {point for point, addresses in seen.items() if len(addresses) > 1}
    dropped = []
    for r in rows:
        if (r.get("lat"), r.get("lon")) in shared:
            del r["lat"], r["lon"]
            dropped.append(r["indirizzo"])
    return dropped


def main() -> None:
    fonti, sedi = [], []
    for slug, (tipo, uso, avviso) in DATASETS.items():
        meta = json.loads(get(API + slug))["result"]
        url = next(r["url"] for r in meta["resources"] if r.get("format", "").upper() == "CSV")
        rows = [sede(tipo, r) for r in read_csv(get(url))]
        rows = [r for r in rows if r.get("nome")]
        dubbie = drop_shared_coords(rows)
        sedi += [{"tipo": tipo, **r, "fonte": slug} for r in rows]
        fonti.append({"id": slug, "tipo": tipo, "titolo": meta["title"], "uso": uso,
                      "url": f"https://dati.comune.milano.it/dataset/{slug}", "csv": url,
                      "aggiornato_dal_comune": meta["metadata_modified"][:10], "licenza": meta.get("license_title", ""),
                      "voci": len(rows), **({"avviso": avviso} if avviso else {}),
                      **({"coordinate_rimosse": dubbie} if dubbie else {})})
        print(f"{slug}: {len(rows)} voci" + (f", coordinate rimosse (punto uguale per indirizzi diversi): {dubbie}" if dubbie else ""))

    # The only office that issues the pass is not in any dataset: added by hand from the service page.
    sedi.insert(0, {"tipo": "pass_disabili", "nome": "Unità Gestione Permessi (pass disabili)",
                    "indirizzo": "Via Sile 8, 20139", "municipio": "4",
                    "note": "Solo su appuntamento, prenotabile online con SPID, CIE o eIDAS.", "fonte": "pagina_servizio"})
    fonti.insert(0, {"id": "pagina_servizio", "tipo": "pass_disabili", "titolo": "Pagina del servizio pass disabili",
                     "url": PAGE, "uso": "Unico sportello che rilascia e rinnova il pass.", "voci": 1})

    OUT.write_text(json.dumps({"scaricato": date.today().isoformat(), "fonti": fonti, "sedi": sedi},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(sedi)} sedi in {OUT}")


if __name__ == "__main__":
    main()
