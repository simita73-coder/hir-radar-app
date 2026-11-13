# Hír-Radar Mobil (Android, v5.5.1)

A `hr_mobil_v4.0.html` (Hír-Radar cikkválogató) és a `triage_mobil_v1_0.html` (döntés + indoklás naplózás) egyesítése,
natív SQLite-tal: a telefon tárhelyén lévő adatbázisokat közvetlenül olvassa és írja, nincs fájlválasztás, export vagy kézi visszamásolás.
Mega nincs benne: az asztali adatbázisokat te másolod a telefonra, az összevonást (v5.1-től) az app maga végzi (lásd lent).

## Újdonságok a v5.5.1-ben
- **Címkejavaslatok új sorrendje:** pontos egyezés, utána az **egy szavas** címkék (előbb amelyek a begépelt szöveggel kezdődnek, pl. `bal` → baleset, balaton; majd amelyek tartalmazzák), végül a többszavas címkék (ugyanígy). Egy csoporton belül a gyakoribb van elöl. A **➕ új** elem a lista végére került. Ez a felső címkekeresőre is érvényes.

## Újdonságok a v5.5-ben
- **Megosztás: csak az új cikk kerül be.** A megosztott webcímet az asztali URL Import szabályával ellenőrzi (kisbetű, utm_… követő paraméterek nélkül, záró `/` nélkül; a `#töredék` megkülönböztet). Ha már van ilyen cikk a Hír-Radarban, a doboz kiírja a státuszát, és a **Hozzáadás gomb tiltott** – meglévő cikket a megosztás sosem ír felül. Ha a cikk nincs a radarban, de a triage.db-ben van róla döntés (pl. végleg törölted), figyelmeztet, de hozzáadható. Az URL a mezőben átírható, az ellenőrzés újra lefut.
- **🏷 Címkék: javaslatok gépelés közben.** A „A cikk címkéi" mezőbe gépelve az utolsó vesszőig tartó szó 3. karakterétől megjelennek a meglévő címkék (sorrend: lásd a v5.5.1-et). Koppintásra a begépelt töredék helyére kerül a címke. Ha nincs pontos egyezés, **➕ új: …** elem is megjelenik (a megszokott tisztítással). A felső kereső is ezt a sorrendet használja.
- **📄 MHTML-lista a Vivaldi MHTML Mentőnek** (⚙️ → MHTML-mentés): kiírja a 💙 menteni, 📖 olvasni és 🔒 védett cikkeket a Hír-Radar mappába `mhtml_lista_ÉÉÉÉHHNN_ÓÓPP.txt` néven (sor: `azonosító|dátum|cím|webcím`, a bővítmény új formátuma). Alapból csak azok jönnek, amelyekhez még nincs MHTML fájl. Az azonosító a webcímből számolt `HR` + 14 hexa jegy, a bővítmény ezt teszi a fájlnévbe (`…_idHR…_domain.mhtml`).
- **Offline megnyitás:** ha egy cikkhez van MHTML fájl a `Norbi/BM-manager/MHTML` mappában (almappákban is keres; a mappa a ⚙️-ban átírható), a megnyitó gomb **📄**, és az offline fájlt nyitja meg; különben 🌐 és a böngésző, mint eddig. Ha az offline fájl nem nyílik meg, a böngészőre vált. A fájlokat az URL-ből számolt azonosító alapján találja meg, a mappa tartalmáról egyszeri indexet készít (100 ezer fájlnál is gyors), és csak akkor olvassa újra, ha a mappa változott.
- **Natív rész (új APK kell):** `writeText`, `findMhtml`, `openFile` a `HrPlugin.java`-ban; a `patch_android.py` gondoskodik a FileProvider-ről (a böngészőnek content:// címet kell adni).

## Újdonságok a v5.4-ben
- **🧠 Hiányzó triage-sorok pótlása** (⚙️ Beállítások): a 💙 / 📖 cikkekhez, amelyeknek nincs triage-sora (pl. az asztali Hír-Radarban döntötted el őket, és az összevonás hozta át), létrehoz egyet indoklás nélkül (menteni / olvasni). A 🗑 cikkeket kihagyja, mert az exportált cikk is 🗑, abból nem derül ki a döntés. A meglévő triage-sorokhoz és a radarhoz nem nyúl. Utána a 🧠 listában a „csak az indoklás nélküliek” szűrővel pótolhatod az indoklást.

## Újdonságok a v5.3-ban
- **🧠 Triage-lista** a 4. sor első gombjaként: a triage.db döntései szűrhetők (döntés, AI-eltérés, csak indoklás nélküliek), és az indoklás utólag írható / szerkeszthető **💾 Indoklás mentése**-sel – a döntés nem változik (lásd lent).
- **Összevonás:** a telefon triage.db-jében már eldöntött cikkeket (a végleg törölteket is) nem hozza vissza az asztali adatbázisból; az előnézet mutatja a kimaradók számát.
- **Védett + 🗑 hiba javítva:** törlésre jelölt cikk nem védhető; az exportált védett cikk védettsége a radarban megszűnik (a BM-ben marad); ⚙️-ben **🔧 Javítás** gomb a már meglévő ilyen cikkekre; az összevonás is javítja őket.
- Hat gomb a 4. sorban: keskenyebb gombok, a hosszú számok (pl. `433 520`) kisebb betűvel.

## Újdonságok a v5.2-ben
- **Szűrőgombok** (🔐 💙 📖 🗑 ✨): magasabbak, és alattuk látszik a darabszámuk.
- **🛡 Véletlen dupla érintés ellen**: az alsó 🔒 / 📖 / 💙 / 🗑 gomb ugyanaz csak 2 mp múlva nyomható újra (lásd lent).
- A verziószám a fejlécben mostantól a `package.json`-ból jön, így minden új build más számot mutat. (Fejlesztői szabály: minden változtatásnál emelni kell a `package.json` verzióját.)

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
**4. sor (módok):** 🧠 triage-lista · 🔐 védett · 💙 menteni · 📖 olvasni · 🗑 törölni · ✨ mind (új + 💙 + 📖). A gombok alatt a darabszám: 🧠 a triage-döntések száma · 🔒 védett · 💙 · 📖 · 🗑 · ✨ alatt a 🟢 új (még el nem döntött) cikkek száma (a hosszú számok, pl. `433 520`, kisebb betűvel, hogy hat gombnál is elférjenek). Alattuk a Σ összes cikk és a 📍 pozíció / lista hossza látszik.
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
- **Dupla érintés elleni védelem:** ugyanaz az alsó gomb (🔒 📖 💙 🗑) az új cikk megjelenésétől számított 2 mp-ig nem nyomható újra (közben halványabb), hogy a következő cikk címét el tudd olvasni. Másik gomb azonnal nyomható. A ↩ és a 🌐 nincs korlátozva. Az idő a ⚙️ Beállításokban átírható (másodperc, 0–10; 0 = ki).
- **Védett és 🗑 kizárja egymást:** védett cikk nem törölhető (🗑 gomb), és törlésre jelölt cikk nem védhető (🔒 gomb: figyelmeztetés, előbb állítsd vissza). A védelem levétele mindig működik. A 🔒 mindkét adatbázisban átállítja a védettséget.
- Ha régebbről mégis maradt védett + 🗑 cikk: ⚙️ → **🔧 Védett és törlésre jelölt cikkek → Javítás** 🟢 újra állítja őket (a védelem marad, a triage-döntés nem változik). Az összevonás is javítja őket.
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
Utána az exportált cikkek a Hír-Radarban 🗑 státuszba kerülnek (mai dátummal), így a lista fogy, a BM gyarapszik. A **védett** cikkek védettsége a BM-be átmegy, a Hír-Radarban viszont megszűnik (védett cikk nem lehet 🗑), így a végleges törlés őket is eltávolítja. A triage-döntések megmaradnak.

## Megosztás
Böngészőben (Vivaldi) Megosztás → **Hír-Radar** → felugrik az ablak: webcím, cím, rovat (a domain korábbi cikkei alapján kitalálja), 💙 menteni / 📖 olvasni, 🔒 védett, indoklás. Mentéskor a radar_memory.db-be és a triage.db-be is bekerül. Ha a cikk már megvan a Hír-Radarban (normalizált URL-egyezés, mint az asztali URL Importnál), jelzi, és a Hozzáadás gomb tiltott – a megosztás meglévő cikket nem ír felül (v5.5-től).

## 🧠 Triage-lista (utólagos indoklás)
A 4. sor első gombja (🧠) a `triage.db` döntéseit listázza – a végleg törölt cikkek is benne vannak (a kártya a triage-sorból épül). Az első koppintás belép és megnyitja a szűrőt, a következő (már triage-módban) csak a szűrőt.
- **Szűrő:** az én döntésem (💙 / 📖 / 🗑 / ❓, több is; egyik sem = mind) · 🤖 AI-döntés (mind / **⚠️ másként döntött, mint én** / ugyanúgy / nincs) · **✍️ csak az indoklás nélküliek**. Az ablak alján élő darabszám. A 🧠 gombon `●` jelzi az aktív szűrőt.
- A 📁 rovat-szűrő (a triage `domain` mezője szerint), a keresés (cím / rovat / dátum / URL) és a ⬇/⬆/🔀 rendezés itt is működik.
- A kártyán: a döntésed, a Hír-Radar-beli státusz (vagy „nincs a radar_memory.db-ben”) és az AI döntése / indoklása. A 💬 mezőbe a meglévő indoklás töltődik.
- **💾 Indoklás mentése:** csak a triage `reason` mezőjét írja (a döntés, a védelem és a radar státusza nem változik), utána a következő cikk jön. Az „indoklás nélküli” szűrőnél a kész cikk kikerül a listából. A ↩ visszavonja az utolsó indoklás-mentést.
- Ebben a módban a 💙 📖 🗑 🔒 gombok és a 🏷 címke nem látszik, így a döntés véletlenül sem változik. Visszalépés: bármelyik másik mód gombja.

## 🔀 Összevonás az asztali adatbázisokkal (⚙️ → 🔀 Összevonás megnyitása)
1. Másold az asztali `radar_memory.db`, `bookmarks.db` és/vagy `triage.db` fájlt a telefon `Norbi/Osszevonas/` mappájába (a mappa a felületen átírható). Ha van, tedd mellé a `tag_case_map.json`-t is (a betűszavak írásmódjához; ha ott nincs, a BM- vagy a Hír-Radar mappában is keresi).
2. **🔎 Fájlok keresése**: bejelölheted, mely adatbázisok vegyenek részt. Csak a bejelöltek változnak.
3. **Bookmarks, leíró mezők**: ha egy közös könyvjelző címe / kategóriája / tags / jegyzete eltér, melyik oldal értéke maradjon (alapértelmezés: **a telefoné**; ha a PC-n tisztítottad a címkéket és az asztali fájl a tisztított, válaszd az asztalit). Az előnézet kiírja, hány könyvjelzőnél van ilyen eltérés. A címkék, az olvasott / törlésre vár / védett állapot mindkét oldalról egyesül.
4. **🧠 Ne hozza vissza a triage-ban már eldöntött cikkeket** (alapból be): a telefon `triage.db`-jében szereplő (💙 📖 🗑) cikkek – a telefonon végleg törölteket és exportáltakat is – nem kerülnek vissza az asztali adatbázisból, csak a valóban új cikkek. A döntés nélküli és a ❓ bizonytalan cikkek bekerülnek. Az előnézet kiírja, hány asztali cikk marad ki emiatt.
5. **📋 Előnézet** (semmit sem ír), majd **✅ Összevonás indítása**.

Biztonság: indítás előtt minden bejelölt telefonos adatbázisról másolat készül az `Osszevonas/mentes/` mappába (`<név>_elotte_ÉÉÉÉHHNN_ÓÓPPMM.db`, adatbázisonként az utolsó 2 marad meg). Ha a másolat nem sikerül (pl. nincs hely), az adott adatbázist nem érinti. Az írás tranzakcióban fut: hiba esetén visszagörget, a telefon adatbázisa változatlan marad. Az asztali fájlokat az app csak olvassa. Az összevonás újrafuttatva ugyanazt az eredményt adja (nem duplikál).

Szabályok (azonosak a PC-s DB Kezelő 4.1-gyel):
- **Hír-Radar**: státusz-sorrend `DELETED` > `READING` > `MARKED` > `SEEN` > `EXPORTED`; a védettség „vagy" (védett cikk nem maradhat törölt: az összevonás után ilyen sor nem marad, 🟢 újra javul); a telefon triage-jében eldöntött, csak az asztalon lévő cikkek kimaradnak (lásd fent); a cikk dátuma törölt / exportált végállapotnál annak az oldalnak a dátuma, amelyik ezt a státuszt hordozza (ha mindkettő, a későbbi), egyébként a korábbi nem üres dátum; a címkék egyesülnek; a `fetch_log` soronként a nagyobb darabszámot tartja.
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
- **dupla érintés elleni védelem** ideje (másodperc, számmező + Alkalmaz);
- **Törölni jelöltek végleges törlése**: a 🗑 státuszú, nem védett cikkek véglegesen törlődnek a radar_memory.db-ből (megerősítéssel). Figyelem: a törlés az összefésülésnél nem „terjed át" az asztali adatbázisra – de az összevonás a telefon triage.db-je alapján (alapbeállítás) nem hozza vissza a már eldöntött cikkeket. Ha a telefon adatbázisa váltja le az asztalit, a törölt cikkeket a Hír-Radar újra „újként" letöltheti;
- **összevonás** az asztali adatbázisokkal (lásd fent);
- **MHTML-mentés:** az MHTML mappa útvonala, a lista kiírása;
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
- `android-extra/HrPlugin.java` – natív rész: több SQLite adatbázis egyszerre, azonosító-listák, ékezetes keresés, linknyitás, megosztás fogadása, fájlmásolás / listázás / törlés / írás, MHTML-fájlok keresése és megnyitása a biztonsági mentésekhez
- `android-extra/MainActivity.java` – a plugin regisztrálása, képernyő bekapcsolva tartása
- `android-extra/debug.keystore` – állandó aláírókulcs
- `scripts/patch_android.py` – a generált Android-projekt kiegészítése (engedélyek, megosztás-fogadás, FileProvider, plugin, aláírás)
- `build-apk.yml` (és a `.github/workflows/` alatti példánya) – a GitHub Actions munkafolyamat
