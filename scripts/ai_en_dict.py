"""Active-ingredient English normalisation for the Global Registration data.

Registrations come from 21 national registries in Spanish, Indonesian, Turkish
and English. Active-ingredient names are a *controlled vocabulary* (ISO common
names), so instead of translating we map each name to its canonical English
common name via a curated dictionary.

``to_english(value)`` returns the English name(s) for a raw active-ingredient
string (multiple actives joined with " + "), or None when nothing is
recognised — the caller then falls back to the original value. The original is
always preserved separately; this only fills a parallel ``active_ingredient_en``.

The dictionary is a STARTER covering the high-frequency ingredients (the top
few hundred cover ~78% of rows); extend CANON over time.
"""
from __future__ import annotations

import re
import unicodedata

# canonical English ISO common name -> list of variant spellings (any language).
# The canonical itself is matched automatically; list only extra variants.
CANON: dict[str, list[str]] = {
    "Glyphosate": ["glifosato", "glifosat", "glifosato isopropilamina", "glyphosate isopropylammonium",
                   "isopropilamina glifosat", "isopropil amina glifosat", "sal isopropilamina de glifosato",
                   "glifosato sal isopropilamina", "glifosat isopropilamina"],
    "Glufosinate-ammonium": ["glufosinato de amonio", "glufosinato amonio", "amonium glufosinat",
                             "glufosinato", "glufosinate ammonium", "glufosinat amonium"],
    "Paraquat dichloride": ["paraquat", "paracuat", "parakuat", "parakuat diklorida", "paraquat dicloruro",
                            "dicloruro de paraquat", "parakuat diklorida paraquat ion", "paraquat ion"],
    "Diquat": ["diquat dibromuro", "dibromuro de diquat", "diquat dibromide"],
    "Atrazine": ["atrazina", "atrazin"],
    "Ametryn": ["ametrina", "ametrin"],
    "Simazine": ["simazina"],
    "Metribuzin": ["metribuzina"],
    "Diuron": ["diuron", "diurón"],
    "Tebuthiuron": ["tebutiuron"],
    "Thiamethoxam": ["tiametoxam", "tiametoxan", "tiamethoxam"],
    "Imidacloprid": ["imidacloprid", "imidakloprid"],
    "Acetamiprid": ["acetamiprid", "asetamiprid"],
    "Clothianidin": ["clotianidina", "clotianidin"],
    "Dinotefuran": ["dinotefuran"],
    "Thiacloprid": ["tiacloprid"],
    "Cypermethrin": ["cipermetrina", "sipermetrin", "cipermetrin", "cypermethrine"],
    "Alpha-cypermethrin": ["alfacipermetrina", "alfa cipermetrina", "alpha cypermethrin"],
    "Deltamethrin": ["deltametrina", "deltametrin"],
    "Lambda-cyhalothrin": ["lambda cialotrina", "lambdacialotrina", "lambda cyhalothrin",
                           "lambda-cialotrina", "lambda sihalotrin"],
    "Bifenthrin": ["bifentrina", "bifentrin"],
    "Permethrin": ["permetrina"],
    "Chlorpyrifos": ["clorpirifos", "clorpirifós", "klorpirifos", "chlorpyrifos-ethyl"],
    "Profenofos": ["profenofós", "profenofos"],
    "Malathion": ["malation", "malatión"],
    "Dimethoate": ["dimetoato"],
    "Fipronil": ["fipronil"],
    "Abamectin": ["abamectina", "abamektin"],
    "Emamectin benzoate": ["emamectina benzoato", "benzoato de emamectina", "emamectin benzoat",
                           "emamectina", "emamektin benzoat"],
    "Chlorantraniliprole": ["clorantraniliprol", "klorantraniliprol", "clorantranilprole"],
    "Cyantraniliprole": ["ciantraniliprol"],
    "Flubendiamide": ["flubendiamida"],
    "Spinetoram": ["spinetoram", "espinetoram"],
    "Spinosad": ["spinosad", "espinosad"],
    "Indoxacarb": ["indoxacarb", "indoxacarbo"],
    "Lufenuron": ["lufenuron"],
    "Buprofezin": ["buprofezina"],
    "Pymetrozine": ["pimetrozina"],
    "Flonicamid": ["flonicamida"],
    "Acephate": ["acefato"],
    "Methomyl": ["metomilo"],
    "Carbofuran": ["carbofuran"],
    "Thiodicarb": ["tiodicarb"],
    "Mancozeb": ["mancozeb"],
    "Propineb": ["propineb"],
    "Metiram": ["metiram"],
    "Chlorothalonil": ["clorotalonil", "klorotalonil"],
    "Carbendazim": ["carbendazim", "carbendazima", "karbendazim"],
    "Benomyl": ["benomilo"],
    "Thiophanate-methyl": ["tiofanato metil", "tiofanato de metilo", "metil tiofanat"],
    "Tebuconazole": ["tebuconazol", "tebukonazol"],
    "Difenoconazole": ["difenoconazol", "difenokonazol"],
    "Propiconazole": ["propiconazol"],
    "Epoxiconazole": ["epoxiconazol"],
    "Hexaconazole": ["hexaconazol", "heksakonazol"],
    "Cyproconazole": ["ciproconazol"],
    "Metconazole": ["metconazol"],
    "Prothioconazole": ["protioconazol"],
    "Azoxystrobin": ["azoxistrobina", "azoksistrobin", "azoxistrobin"],
    "Pyraclostrobin": ["piraclostrobina", "piraklostrobin"],
    "Trifloxystrobin": ["trifloxistrobina"],
    "Kresoxim-methyl": ["kresoxim metil", "cresoxim metilo"],
    "Boscalid": ["boscalida"],
    "Fluazinam": ["fluazinam"],
    "Fludioxonil": ["fludioxonil"],
    "Metalaxyl": ["metalaxil"],
    "Metalaxyl-M": ["metalaxil m", "metalaxil-m", "mefenoxam"],
    "Cymoxanil": ["cimoxanilo", "cymoxanil"],
    "Mandipropamid": ["mandipropamida"],
    "Dimethomorph": ["dimetomorf"],
    "Iprodione": ["iprodiona"],
    "Copper oxychloride": ["oxicloruro de cobre", "oxicloruro cobre", "tembaga oksiklorida"],
    "Copper hydroxide": ["hidroxido de cobre", "hidróxido de cobre"],
    "Sulphur": ["azufre", "sulfur", "belerang"],
    "Tricyclazole": ["triciclazol"],
    "2,4-D": ["2 4 d", "24 d", "acido 2 4 d", "2,4-d dimetilamina", "2,4-d dimetil amina",
             "d dimetil amina", "d dimetilamina", "d dimethylammonium", "2,4 d amina",
             "sal dimetilamina de 2,4-d", "2,4-d amine", "2,4-d dimethylamine"],
    "MCPA": ["mcpa"],
    "Dicamba": ["dicamba"],
    "Picloram": ["picloram"],
    "Triclopyr": ["triclopir"],
    "Fluroxypyr": ["fluroxipir"],
    "Aminopyralid": ["aminopiralid"],
    "Metsulfuron-methyl": ["metsulfuron metil", "metil metsulfuron", "metsulfuron metilo",
                           "metsulfuron-metil"],
    "Nicosulfuron": ["nicosulfuron"],
    "Sulfentrazone": ["sulfentrazona"],
    "Saflufenacil": ["saflufenacil"],
    "Flumioxazin": ["flumioxazina"],
    "Carfentrazone-ethyl": ["carfentrazone etil", "carfentrazona"],
    "Mesotrione": ["mesotriona"],
    "Tembotrione": ["tembotriona"],
    "Pendimethalin": ["pendimetalina", "pendimetalin"],
    "Trifluralin": ["trifluralina"],
    "S-metolachlor": ["s metolacloro", "s-metolacloro", "metolacloro", "metolaklor"],
    "Acetochlor": ["acetocloro", "asetoklor"],
    "Alachlor": ["alacloro"],
    "Clomazone": ["clomazona", "klomazon"],
    "Imazethapyr": ["imazetapir"],
    "Imazapyr": ["imazapir"],
    "Imazapic": ["imazapic"],
    "Imazamox": ["imazamox"],
    "Oxyfluorfen": ["oxifluorfen", "oksifluorfen"],
    "Fomesafen": ["fomesafen"],
    "Bentazone": ["bentazona", "bentazon"],
    "Clethodim": ["cletodim"],
    "Haloxyfop": ["haloxifop", "haloxyfop-p-methyl", "haloxifop metil"],
    "Fluazifop-P-butyl": ["fluazifop p butil", "fluazifop butilo", "fluazifop"],
    "Quizalofop-P-ethyl": ["quizalofop p etil", "quizalofop etilo", "quizalofop"],
    "Sethoxydim": ["setoxidim"],
    "Isoproturon": ["isoproturon"],
    "Diafenthiuron": ["diafentiuron"],
    "Pyriproxyfen": ["piriproxifen"],
    "Novaluron": ["novaluron"],
    "Chlorfenapyr": ["clorfenapir", "klorfenapir"],
    "Fenpyroximate": ["fenpiroximato"],
    "Propargite": ["propargita"],
    "Spiromesifen": ["spiromesifen", "espiromesifeno"],
    "Spirodiclofen": ["espirodiclofeno"],
    "Hexythiazox": ["hexitiazox"],
    "Etoxazole": ["etoxazol"],
    "Sulfoxaflor": ["sulfoxaflor"],
    "Flupyradifurone": ["flupiradifurona"],
    "Pyroxasulfone": ["piroxasulfona"],
    "Prometryn": ["prometrina"],
    "Linuron": ["linuron"],
    "Terbuthylazine": ["terbutilazina"],
    "Glyphosate-trimesium": ["sulfosato", "glifosato trimesium"],
    "Chlorimuron-ethyl": ["clorimuron etil"],
    "Bispyribac-sodium": ["bispiribac sodio", "bispyribac sodium"],
    "Penoxsulam": ["penoxsulam"],
    "Cyhalofop-butyl": ["cihalofop butil", "cyhalofop butyl"],
    "Propanil": ["propanil"],
    "Molinate": ["molinato"],
    "Clodinafop-propargyl": ["clodinafop propargil"],
    "Pinoxaden": ["pinoxaden"],
    "Prosulfuron": ["prosulfuron"],
    "Iprovalicarb": ["iprovalicarb"],
    "Propamocarb": ["propamocarb", "propamocarb hidrocloruro"],
    "Fosetyl-aluminium": ["fosetil aluminio", "fosetil al", "fosetyl al"],
    "Chlorpyrifos-methyl": ["clorpirifos metil"],
}

# --- build the variant -> canonical lookup (all keys accent/space-normalised) ---
def _key(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()

_LOOKUP: dict[str, str] = {}
for _canon, _variants in CANON.items():
    _LOOKUP[_key(_canon)] = _canon.strip()
    for _v in _variants:
        _LOOKUP[_key(_v)] = _canon.strip()

# Source-language filler to drop (mostly Indonesian "equivalent to ..." noise).
_NOISE = re.compile(r"\b(setara dengan|active equivalent|equivalent to|sebagai|dengan)\b", re.I)


def _prep(value: str) -> str:
    """Accent-fold + lowercase, drop parenthetical/filler noise, hyphens->spaces.
    Keeps digits, %, commas and units so the CONCENTRATION is preserved
    (e.g. "ABAMECTINA 8,4%" -> "abamectina 8,4%")."""
    s = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)     # drop parentheticals (often duplicate the name)
    s = _NOISE.sub(" ", s)
    s = s.replace("-", " ")
    return re.sub(r"[ \t]+", " ", s).strip()


# One alternation over every variant, longest first so the most specific name
# at a position wins. Each variant is a whole "word run" (space-delimited).
_VARIANTS = sorted(_LOOKUP.keys(), key=len, reverse=True)
_SCAN = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(v) for v in _VARIANTS) + r")(?![a-z0-9])")


def to_english(value: str | None) -> str | None:
    """Anglicise a raw active-ingredient string: replace every recognised name
    (any language) with its canonical English name IN PLACE, keeping the
    concentration and structure — e.g. "ABAMECTINA 8,4%" -> "Abamectin 8,4%",
    "IMAZAPIC 52,5%, IMAZAPIR 17,5%" -> "Imazapic 52,5%, Imazapyr 17,5%".
    Returns None when no known ingredient is found (caller keeps the original)."""
    if not value:
        return None
    hit = False

    def _repl(m: "re.Match[str]") -> str:
        nonlocal hit
        hit = True
        return _LOOKUP[m.group(1)]

    out = _SCAN.sub(_repl, _prep(value))
    if not hit:
        return None
    out = re.sub(r"\s+", " ", out).strip(" ,;+/&")
    return out or None
