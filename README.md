# Hír-Radar Mobil (Android, v5.1)

A `hr_mobil_v4.0.html` (Hír-Radar cikkválogató) és a `triage_mobil_v1_0.html` (döntés + indoklás naplózás) egyesítése,
natív SQLite-tal: a telefon tárhelyén lévő adatbázisokat közvetlenül olvassa és írja, nincs fájlválasztás, export vagy kézi visszamásolás.
Mega nincs benne: az asztali adatbázisokat te másolod a telefonra, az összevonást (v5.1-től) az app maga végzi (lásd lent).

## Újdonságok a v5.1-ben
- **📁 Rovat szűrő**: rovat szerint választod ki, mi jelenjen meg (gyorsabb, mint a véletlen sorrend, ha pl. a sport és tudomány rovatot gyorsan törlöd).
- **🔀 Összevonás az asztali adatbázisokkal** a ⚙️ Beállításokban: radar_memory.db, bookmarks.db, triage.db, a PC-s DB Kezelő 4.1 szabályaival.

## Fájlok a telefonon (alapértelmezett útvonalak, a ⚙️ Beállításokban átírhatók)
| Fájl | Útvonal |
|---|---|
| Hír-Radar adatbázis | `/storage/emulated/0/Norbi/Hir-Radar/radar_memory.db` |
| Triage adatbázis | `/storage/emulated/0/Norbi/Hir-Radar/triage.db` |
| Könyvjelzők (BM) | `/storage/emulated/0/Norbi/BM-manager/bookmarks.db` |

- A `Norbi/Hir-Radar` és `Norbi/BM-manager` mappát te hozod létre, és te másolod bele az adatbázisokat.
- A `triage.db` induláskor az asztali `triage.db` másolata legyen (benne vannak a korábbi döntések). Ha a fájl nincs ott, az app létrehozza (üres táblával).
- Az első indításkor az app kéri a „Minden fájl kezelése" engedélyt: ⚙️ → **Engedély megadása** → kapcsold be, majd lépj vissza.

## Gombok
**Fejléc:** ▲ gombsorok elrejtése · 🌙/☀️ téma · **📤 N** mentés a BM-be (N = a 💙 és 📖 jelölt cikkek száma)
**1. sor:** ⚙️ beállítások · ↩ visszavonás · ⬇/⬆ dátum szerint (első nyomás: legújabb elöl) · 🔀 véletlen · 📁 rovat szűrő
**Keresés:** legalább 3 karakter; a „Miben" gombbal: cím / rovat / dátum / URL, teljes szó. Az ékezetes betűk kis- és nagybetűs alakja egyezik (`őrült` = `ŐRÜLT`).
**2. sor:** 🔐 védett · 💙 menteni · 📖 olvasni · 🗑 törölni · ✨ mind (új + 💙 + 📖)
**Kártya alatt:** 💬 **Miért?** mező (indoklás) és a 🏷 **címke** gomb
**Alul:** 🌐 megnyitás az alapértelmezett böngészőben (Vivaldi) · 🔒 védelem · 📖 olvasni · 💙 menteni · 🗑 törölni
Lapozás: húzás balra/jobbra a cikken.

## 📁 Rovat szűrő
Az 1. sorban a 📁 gomb (szűrés közben `📁N`, N = kijelölt rovatok száma; `📁●` ha a „Csak új" be van kapcsolva).
- A lista rovatonként mutatja a cikkek számát és mellette a 🟢 még el nem döntött (új) cikkek számát; **Db** / **A–Z** rendezés, a keresőmező szűri a listát.
- Négyzetek: több rovat is kijelölhető. A **rovat nevére** koppintva csak az az egy rovat marad kijelölve.
- **Kivéve a kijelölteket**: megfordítja a szűrést (minden rovat, a kijelölteken kívül); ilyenkor a gomb borostyán színű.
- **🟢 Csak új (el nem döntött)**: csak a ✨ módban elérhető, csak az új (`SEEN`) cikkeket mutatja.
- **✨ Mind** törli a szűrést, **✔ Alkalmaz** érvényesíti.
- A szűrés a 🔐 / 💙 / 📖 / 🗑 / ✨ módok között megmarad, így rovatonként végig lehet menni a cikkeken; az app újraindításakor törlődik. A lapozás és a ⬇/⬆/🔀 rendezés a szűrt listán működik.

## Döntések és a triage
A 💙 / 📖 / 🗑 gomb **egyszerre** két helyre ír:
1. `radar_memory.db`: a cikk státusza `MARKED` / `READING` / `DELETED` lesz;
2. `triage.db` (`decisions` tábla, `source='hr'`, `article_key=URL`): `menteni` / `olvasni` / `torolni` + a Miért? mezőbe írt indoklás (üresen is). A meglévő sort frissíti, az AI-mezőket nem bántja.

- Ugyanaz a gomb újra: a cikk visszaáll (`SEEN`, döntés nélkül); az indoklás megmarad.
- Döntés után az app automatikusan a következő cikkre lép.
- Védett cikk nem törölhető. A 🔒 mindkét adatbázisban átállítja a védettséget.
- A kártyán látszik a triage-ben tárolt döntés és (ha van) az AI döntése/indoklása; az indoklás előtöltődik a mezőbe.
- A lapozás nem ment: ha beírtál indoklást, de nem döntöttél, az app figyelmeztet, hogy nem mentődött.
- ↩ az utolsó műveletet (döntés vagy védelem) mindkét adatbázisban visszavonja.
- Az „🧠" szám a triage-be került döntések száma.

## Címkék (🏷)
A radar_memory.db-ben új `custom_tags` oszlop jön létre (az app hozzáadja). A 🏷 ablakban a BM összes címkéje között kereshetsz (3 karaktertől), kattintásra hozzáadódik; mentéskor a címkék egységes alakra kerülnek (a `tag_clean` szabályai: kisbetű, kivéve a betűszavak; ismétlések és szélső `[ ] "` jelek nélkül; `a, b` formátum).
Ha a BM-mappában (vagy a Hír-Radar mappában) van `tag_case_map.json` (a BM címketisztító készíti), az app azt is használja a betűszavakhoz.

## 📤 Mentés a BM-be
A 💙 és 📖 jelölt cikkek bekerülnek a `bookmarks.db`-be, mint az asztali Hír-Radar „Export → BM" funkciójánál:
kategória = rovat, státusz = „ÚJ FOGÁS (Radar)", domain az URL-ből, a címkék a `custom_tags`-be, védettség átmegy, az 📖 cikkek olvasásra várónak (`is_read=1`) kerülnek.
Ha a cikk már a BM-ben van: nem készül másolat; a védettség (csak beállítható, levenni nem), az olvasásra jelölés és a címkék (a meglévőkhöz hozzáadva) frissülnek; a „cím és státusz is frissüljön" négyzettel a cím és a státusz is.
Utána az exportált cikkek a Hír-Radarban 🗑 státuszba kerülnek (mai dátummal), így a lista fogy, a BM gyarapszik. A triage-döntések megmaradnak.

## Megosztás
Böngészőben (Vivaldi) Megosztás → **Hír-Radar** → felugrik az ablak: webcím, cím, rovat (a domain korábbi cikkei alapján kitalálja), 💙 menteni / 📖 olvasni, 🔒 védett, indoklás. Mentéskor a radar_memory.db-be és a triage.db-be is bekerül. Ha a cikk már megvan, jelzi, és a mentés felülírja.

## 🔀 Összevonás az asztali adatbázisokkal (⚙️ → 🔀 Összevonás megnyitása)
1. Másold az asztali `radar_memory.db`, `bookmarks.db` és/vagy `triage.db` fájlt a telefon `Norbi/Osszevonas/` mappájába (a mappa a felületen átírható). Ha van, tedd mellé a `tag_case_map.json`-t is (a betűszavak írásmódjához; ha ott nincs, a BM- vagy a Hír-Radar mappában is keresi).
2. **🔎 Fájlok keresése**: bejelölheted, mely adatbázisok vegyenek részt. Csak a bejelöltek változnak.
3. **Bookmarks, leíró mezők**: ha egy közös könyvjelző címe / kategóriája / tags / jegyzete eltér, melyik oldal értéke maradjon (alapértelmezés: **a telefoné**; ha a PC-n tisztítottad a címkéket és az asztali fájl a tisztított, válaszd az asztalit). Az előnézet kiírja, hány könyvjelzőnél van ilyen eltérés. A címkék, az olvasott / törlésre vár / védett állapot mindkét oldalról egyesül.
4. **📋 Előnézet** (semmit sem ír), majd **✅ Összevonás indítása**.

Biztonság: indítás előtt minden bejelölt telefonos adatbázisról másolat készül az `Osszevonas/mentes/` mappába (`<név>_elotte_ÉÉÉÉHHNN_ÓÓPPMM.db`, adatbázisonként az utolsó 2 marad meg). Ha a másolat nem sikerül (pl. nincs hely), az adott adatbázist nem érinti. Az írás tranzakcióban fut: hiba esetén visszagörget, a telefon adatbázisa változatlan marad. Az asztali fájlokat az app csak olvassa. Az összevonás újrafuttatva ugyanazt az eredményt adja (nem duplikál).

Szabályok (azonosak a PC-s DB Kezelő 4.1-gyel):
- **Hír-Radar**: státusz-sorrend `DELETED` > `READING` > `MARKED` > `SEEN` > `EXPORTED`; a védettség „vagy" (védett cikk nem maradhat törölt); a cikk dátuma törölt / exportált végállapotnál annak az oldalnak a dátuma, amelyik ezt a státuszt hordozza (ha mindkettő, a későbbi), egyébként a korábbi nem üres dátum; a címkék egyesülnek; a `fetch_log` soronként a nagyobb darabszámot tartja.
- **Bookmarks**: az URL azonosít (azonos URL-ű többszörös sorok azonosító-sorrendben párosodnak); állapot-sorrend `törlésre vár` > `olvasott` > normál; védettség „vagy"; a jegyzetek egyesülnek; a `deleted_log` két oldala egyesül; a csak az asztalon meglévő könyvjelzők bekerülnek.
- **Triage**: a kulcs `source` + `article_key`; döntés-sorrend `menteni` > `olvasni` > `törölni` > `bizonytalan` > nincs; az AI-mezők a nyertes oldalról; `created_at` a korábbi, `updated_at` a későbbi.

Korlátok:
- Az összevonás nem követ „visszavonást": ha egy cikket az egyik oldalon törölve jelöltél, a másik oldalról nem áll vissza.
- A telefonon végleg törölt BM-sor nem törlődik az asztalról, és fordítva sem (az összevonás csak hozzáad és egyesít).
- Csak az egyik oldalon létező sorok címkéit az összevonás nem tisztítja át.
- Az asztali könyvjelzők közül az URL nélküliakat kihagyja.
- Nagy fájloknál (430 ezer cikk) eltarthat egy ideig (a teszt gépen is érezhető volt); az összevonás alatt hagyd az appot előtérben, a képernyő bekapcsolva marad.
- A tesztek Linuxon, a PC-s Python-program eredményével összevetve futottak (valós méretű adatokon is, egyező eredménnyel); valódi Android-eszközön az összevonás még nem volt kipróbálva.

## Beállítások (⚙️)
- adatbázis-útvonalak (+ állapot), engedély;
- **Törölni jelöltek végleges törlése**: a 🗑 státuszú, nem védett cikkek véglegesen törlődnek a radar_memory.db-ből (megerősítéssel). Figyelem: a törlés az összefésülésnél nem „terjed át" az asztali adatbázisra, és ha a telefon adatbázisa váltja le az asztalit, a törölt cikkeket a Hír-Radar újra „újként" letöltheti;
- **összevonás** az asztali adatbázisokkal (lásd fent);
- színek.

## Egyéb
- **Gyorsító index:** első indításkor az app egy `idx_memory_status` indexet készít a radar_memory.db-ben (pár másodperc, egyszeri), hogy a 430 ezer cikkes tábla számlálása és szűrése gyors legyen. Az asztali programot nem zavarja.
- Vissza gomb: előbb bezárja a megnyitott ablakot; főképernyőn kétszer kell megnyomni a kilépéshez.
- A képernyő bekapcsolva marad, amíg az app előtérben van.

## Az APK készítése
Új GitHub-repó (pl. `hir-radar-app`), a fájlok feltöltése **egyetlen commitban**, a `.github/workflows/build-apk.yml` helyen a munkafolyamat. Minden push a `main` ágra lefut, és a **Releases** oldalra kiteszi:
`https://github.com/<felhasznalonev>/hir-radar-app/releases/latest/download/hir-radar.apk`

Az APK a többi appoddal azonos állandó aláírókulccsal készül (`android-extra/debug.keystore`), a beállítások az új verzió telepítésekor megmaradnak. (A csomagnév `hu.norbi.hirradar`, külön app, a régi mobil HTML-ek mellett is használható.)

## Fájlok
- `www/index.html`, `src/main.js` – a felület és a logika (a build `www/app.js`-t készít belőle)
- `src/tags.js`, `src/merge.js` – címke-segédek, illetve az összevonás (a DB Kezelő 4.1 szabályai)
- `android-extra/HrPlugin.java` – natív rész: több SQLite adatbázis egyszerre, azonosító-listák, ékezetes keresés, linknyitás, megosztás fogadása, fájlmásolás / listázás / törlés a biztonsági mentésekhez
- `android-extra/MainActivity.java` – a plugin regisztrálása, képernyő bekapcsolva tartása
- `android-extra/debug.keystore` – állandó aláírókulcs
- `scripts/patch_android.py` – a generált Android-projekt kiegészítése (engedélyek, megosztás-fogadás, plugin, aláírás)
- `build-apk.yml` (és a `.github/workflows/` alatti példánya) – a GitHub Actions munkafolyamat
