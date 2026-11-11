package __PACKAGE__;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

/**
 * Hír-Radar Mobil natív része:
 *  - közvetlen SQLite-hozzáférés a telefon tárhelyén lévő adatbázisokhoz ("minden fájl kezelése" engedéllyel);
 *    egyszerre több adatbázis is nyitva lehet (radar_memory.db, triage.db, bookmarks.db), névvel azonosítva,
 *  - azonosító-listák egyetlen szövegben (nagy táblákhoz), magyar ékezetes kisbetűs kereséssel,
 *  - webcím megnyitása az alapértelmezett böngészőben,
 *  - a böngészőből "Megosztás" menüvel érkező link fogadása,
 *  - fájlmásolás / listázás / saját biztonsági másolat törlése (az összevonás előtti mentéshez).
 */
@CapacitorPlugin(name = "HrNative")
public class HrPlugin extends Plugin {

    private static final Locale HU = Locale.forLanguageTag("hu-HU");

    private final Map<String, SQLiteDatabase> dbs = new HashMap<>();

    // A megosztással érkezett, még fel nem dolgozott szöveg
    private String pendingText = null;
    private String pendingSubject = null;

    private static String msg(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    private boolean granted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true;
    }

    // ------------------------------------------------------------------ megosztás fogadása

    @Override
    public void load() {
        readShareIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (readShareIntent(intent)) {
            notifyListeners("shared", takePending());
        }
    }

    private boolean readShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return false;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        // Ne dolgozzuk fel kétszer ugyanazt az intentet (pl. az Activity újraindításakor)
        intent.setAction(Intent.ACTION_MAIN);
        if (text == null || text.trim().isEmpty()) {
            return false;
        }
        pendingText = text;
        pendingSubject = subject;
        return true;
    }

    private JSObject takePending() {
        JSObject r = new JSObject();
        r.put("text", pendingText == null ? "" : pendingText);
        r.put("subject", pendingSubject == null ? "" : pendingSubject);
        pendingText = null;
        pendingSubject = null;
        return r;
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        call.resolve(takePending());
    }

    // ------------------------------------------------------------------ engedély, útvonalak

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("root", Environment.getExternalStorageDirectory().getAbsolutePath());
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + pkg));
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    @PluginMethod
    public void checkPath(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path);
        JSObject r = new JSObject();
        r.put("exists", f.exists());
        r.put("isFile", f.isFile());
        r.put("isDir", f.isDirectory());
        r.put("size", f.isFile() ? f.length() : 0);
        call.resolve(r);
    }

    // ------------------------------------------------------------------ SQLite: megnyitás, zárás

    /** Név szerint megnyitja az adatbázist. create=true: ha nincs ilyen fájl, létrehozza (a mappával együtt). */
    @PluginMethod
    public void openDb(PluginCall call) {
        String name = call.getString("db");
        try {
            String path = call.getString("path");
            if (name == null || name.isEmpty()) {
                call.reject("Hiányzó adatbázis-név");
                return;
            }
            if (path == null || path.trim().isEmpty()) {
                call.reject("Hiányzó adatbázis-útvonal");
                return;
            }
            boolean create = Boolean.TRUE.equals(call.getBoolean("create", false));
            File f = new File(path);
            boolean created = false;
            if (!f.isFile()) {
                if (!create) {
                    call.reject("Az adatbázis nem található: " + path);
                    return;
                }
                File parent = f.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                    call.reject("A mappa nem hozható létre: " + parent.getPath());
                    return;
                }
                created = true;
            }
            closeQuietly(name);
            int flags = SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.NO_LOCALIZED_COLLATORS
                    | (create ? SQLiteDatabase.CREATE_IF_NECESSARY : 0);
            SQLiteDatabase d = SQLiteDatabase.openDatabase(path, null, flags);
            dbs.put(name, d);
            // Mega-mappában vagyunk: ne maradjon -wal/-shm fájl az adatbázis mellett, csak rövid életű -journal
            try {
                Cursor c = d.rawQuery("PRAGMA journal_mode=DELETE", null);
                c.moveToFirst();
                c.close();
            } catch (Exception ignored) {
                // nem végzetes
            }
            JSObject r = new JSObject();
            r.put("path", path);
            r.put("size", f.length());
            r.put("created", created);
            call.resolve(r);
        } catch (Exception e) {
            if (name != null) {
                closeQuietly(name);
            }
            call.reject("Az adatbázis nem nyitható meg: " + msg(e));
        }
    }

    @PluginMethod
    public void closeDb(PluginCall call) {
        String name = call.getString("db");
        if (name != null) {
            closeQuietly(name);
        }
        call.resolve();
    }

    private void closeQuietly(String name) {
        SQLiteDatabase d = dbs.remove(name);
        try {
            if (d != null) {
                d.close();
            }
        } catch (Exception ignored) {
            // nincs mit tenni
        }
    }

    private SQLiteDatabase need(PluginCall call) {
        String name = call.getString("db");
        SQLiteDatabase d = name == null ? null : dbs.get(name);
        if (d == null) {
            call.reject("Nincs megnyitott adatbázis: " + name);
        }
        return d;
    }

    // ------------------------------------------------------------------ SQLite: paraméterek

    private String[] textArgs(JSONArray params) throws Exception {
        if (params == null) {
            return new String[0];
        }
        String[] out = new String[params.length()];
        for (int i = 0; i < out.length; i++) {
            Object o = params.get(i);
            out[i] = (o == null || o == JSONObject.NULL) ? null : String.valueOf(o);
        }
        return out;
    }

    private void bindAll(SQLiteStatement st, JSONArray params) throws Exception {
        if (params == null) {
            return;
        }
        for (int i = 0; i < params.length(); i++) {
            Object o = params.get(i);
            int idx = i + 1;
            if (o == null || o == JSONObject.NULL) {
                st.bindNull(idx);
            } else if (o instanceof Boolean) {
                st.bindLong(idx, ((Boolean) o) ? 1 : 0);
            } else if (o instanceof Integer || o instanceof Long) {
                st.bindLong(idx, ((Number) o).longValue());
            } else if (o instanceof Number) {
                double d = ((Number) o).doubleValue();
                if (d == Math.rint(d) && Math.abs(d) < 9.0e15) {
                    st.bindLong(idx, (long) d);
                } else {
                    st.bindDouble(idx, d);
                }
            } else {
                st.bindString(idx, String.valueOf(o));
            }
        }
    }

    // ------------------------------------------------------------------ SQLite: lekérdezések

    /** SELECT. Válasz: {columns:[...], rows:[[...]]}. */
    @PluginMethod
    public void query(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        Cursor c = null;
        try {
            String sql = call.getString("sql");
            c = db.rawQuery(sql, textArgs(call.getArray("params")));
            int n = c.getColumnCount();
            JSArray cols = new JSArray();
            for (int i = 0; i < n; i++) {
                cols.put(c.getColumnName(i));
            }
            JSArray rows = new JSArray();
            while (c.moveToNext()) {
                JSArray row = new JSArray();
                for (int i = 0; i < n; i++) {
                    putValue(row, c, i);
                }
                rows.put(row);
            }
            JSObject r = new JSObject();
            r.put("columns", cols);
            r.put("rows", rows);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        } finally {
            if (c != null) {
                c.close();
            }
        }
    }

    private void putValue(JSArray arr, Cursor c, int i) {
        switch (c.getType(i)) {
            case Cursor.FIELD_TYPE_INTEGER:
                arr.put(c.getLong(i));
                break;
            case Cursor.FIELD_TYPE_FLOAT:
                try {
                    arr.put(c.getDouble(i));   // a JSONArray.put(double) JSONException-t dobhat (NaN/végtelen)
                } catch (Exception e) {
                    arr.put(JSONObject.NULL);
                }
                break;
            case Cursor.FIELD_TYPE_STRING:
                arr.put(c.getString(i));
                break;
            default:
                arr.put(JSONObject.NULL);
        }
    }

    /** Az első oszlop egész számai vesszővel elválasztott szövegben ("csv"), shuffle=true esetén összekeverve. */
    @PluginMethod
    public void queryIds(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        Cursor c = null;
        try {
            c = db.rawQuery(call.getString("sql"), textArgs(call.getArray("params")));
            IdList ids = new IdList();
            while (c.moveToNext()) {
                ids.add(c.getLong(0));
            }
            call.resolve(idsResult(ids, Boolean.TRUE.equals(call.getBoolean("shuffle", false))));
        } catch (Exception e) {
            call.reject(msg(e));
        } finally {
            if (c != null) {
                c.close();
            }
        }
    }

    /**
     * Szöveges keresés magyar ékezetes kisbetűsítéssel (az SQLite LOWER() csak az ASCII betűket kezeli).
     * Az SQL első oszlopa az azonosító, a többi a keresendő szöveges mező. Egy sor találat, ha bármelyik mező
     * (kisbetűsítve) tartalmazza a keresett szöveget (word=true: teljes szóként).
     */
    @PluginMethod
    public void searchIds(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        Cursor c = null;
        try {
            String needle = call.getString("needle", "").toLowerCase(HU);
            boolean word = Boolean.TRUE.equals(call.getBoolean("word", false));
            String wordNeedle = " " + needle + " ";
            c = db.rawQuery(call.getString("sql"), textArgs(call.getArray("params")));
            int cols = c.getColumnCount();
            IdList ids = new IdList();
            while (c.moveToNext()) {
                boolean hit = false;
                for (int i = 1; i < cols && !hit; i++) {
                    String s = c.getString(i);
                    if (s == null || s.isEmpty()) {
                        continue;
                    }
                    String ls = s.toLowerCase(HU);
                    hit = word ? (" " + ls + " ").contains(wordNeedle) : ls.contains(needle);
                }
                if (hit) {
                    ids.add(c.getLong(0));
                }
            }
            call.resolve(idsResult(ids, Boolean.TRUE.equals(call.getBoolean("shuffle", false))));
        } catch (Exception e) {
            call.reject(msg(e));
        } finally {
            if (c != null) {
                c.close();
            }
        }
    }

    /** Növekvő long-tömb (nagy listákhoz, dobozolás nélkül). */
    private static final class IdList {
        long[] a = new long[1024];
        int n = 0;

        void add(long v) {
            if (n == a.length) {
                a = java.util.Arrays.copyOf(a, n * 2);
            }
            a[n++] = v;
        }
    }

    private JSObject idsResult(IdList ids, boolean shuffle) {
        if (shuffle) {
            Random rnd = new Random();
            for (int i = ids.n - 1; i > 0; i--) {
                int j = rnd.nextInt(i + 1);
                long t = ids.a[i];
                ids.a[i] = ids.a[j];
                ids.a[j] = t;
            }
        }
        StringBuilder sb = new StringBuilder(ids.n * 7 + 16);
        for (int i = 0; i < ids.n; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(ids.a[i]);
        }
        JSObject r = new JSObject();
        r.put("csv", sb.toString());
        r.put("n", ids.n);
        return r;
    }

    // ------------------------------------------------------------------ SQLite: írás

    private static long execOne(SQLiteStatement st, String sql) {
        String u = sql.trim().toUpperCase(Locale.ROOT);
        if (u.startsWith("INSERT")) {
            return st.executeInsert();
        }
        if (u.startsWith("UPDATE") || u.startsWith("DELETE") || u.startsWith("REPLACE")) {
            return st.executeUpdateDelete();
        }
        st.execute();
        return 0;
    }

    /** INSERT / UPDATE / DELETE típusos paraméterekkel. Válasz: {changes} vagy INSERT-nél {id}. */
    @PluginMethod
    public void run(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        SQLiteStatement st = null;
        try {
            String sql = call.getString("sql");
            st = db.compileStatement(sql);
            bindAll(st, call.getArray("params"));
            long v = execOne(st, sql);
            JSObject r = new JSObject();
            if (sql.trim().toUpperCase(Locale.ROOT).startsWith("INSERT")) {
                r.put("id", v);
            } else {
                r.put("changes", v);
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        } finally {
            if (st != null) {
                st.close();
            }
        }
    }

    /** Több utasítás egyetlen tranzakcióban: ops=[{sql, params}, ...]. Válasz: {results:[...]} (INSERT: azonosító, egyébként módosított sorok). */
    @PluginMethod
    public void batch(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        try {
            JSArray ops = call.getArray("ops");
            JSArray results = new JSArray();
            db.beginTransaction();
            try {
                if (ops != null) {
                    for (int i = 0; i < ops.length(); i++) {
                        JSONObject op = ops.getJSONObject(i);
                        String sql = op.getString("sql");
                        SQLiteStatement st = db.compileStatement(sql);
                        try {
                            bindAll(st, op.optJSONArray("params"));
                            results.put(execOne(st, sql));
                        } finally {
                            st.close();
                        }
                    }
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            JSObject r = new JSObject();
            r.put("results", results);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    /** Paraméter nélküli utasítás (pl. ALTER TABLE, CREATE INDEX). */
    @PluginMethod
    public void exec(PluginCall call) {
        SQLiteDatabase db = need(call);
        if (db == null) {
            return;
        }
        try {
            db.execSQL(call.getString("sql"));
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    /** Kis szövegfájl beolvasása (pl. tag_case_map.json). Ha nincs ilyen fájl: {text:"", exists:false}. */
    @PluginMethod
    public void readText(PluginCall call) {
        try {
            File f = new File(call.getString("path", ""));
            JSObject r = new JSObject();
            if (!f.isFile() || f.length() > 2_000_000L) {
                r.put("text", "");
                r.put("exists", false);
                call.resolve(r);
                return;
            }
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            try {
                byte[] buf = new byte[(int) f.length()];
                int off = 0;
                while (off < buf.length) {
                    int n = in.read(buf, off, buf.length - off);
                    if (n < 0) {
                        break;
                    }
                    off += n;
                }
                r.put("text", new String(buf, 0, off, java.nio.charset.StandardCharsets.UTF_8));
            } finally {
                in.close();
            }
            r.put("exists", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    // ------------------------------------------------------------------ fájlok (biztonsági másolat az összevonás előtt)

    /** Fájl másolása ideiglenes névre, majd átnevezéssel; a célmappát létrehozza, a szabad helyet ellenőrzi. */
    @PluginMethod
    public void copyFile(PluginCall call) {
        File tmp = null;
        try {
            File src = new File(call.getString("src", ""));
            File dst = new File(call.getString("dst", ""));
            if (!src.isFile()) {
                call.reject("A másolandó fájl nem található: " + src.getPath());
                return;
            }
            if (dst.exists()) {
                call.reject("A célfájl már létezik: " + dst.getPath());
                return;
            }
            File parent = dst.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                call.reject("A mappa nem hozható létre: " + parent.getPath());
                return;
            }
            if (parent != null && parent.getUsableSpace() < src.length() + 64L * 1024L * 1024L) {
                call.reject("Nincs elég szabad hely a biztonsági másolathoz");
                return;
            }
            tmp = new File(dst.getPath() + ".tmp");
            java.io.FileInputStream in = new java.io.FileInputStream(src);
            try {
                java.io.FileOutputStream out = new java.io.FileOutputStream(tmp);
                try {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                    }
                    out.getFD().sync();
                } finally {
                    out.close();
                }
            } finally {
                in.close();
            }
            if (tmp.length() != src.length() || !tmp.renameTo(dst)) {
                tmp.delete();
                call.reject("A másolás nem sikerült: " + dst.getPath());
                return;
            }
            JSObject r = new JSObject();
            r.put("path", dst.getPath());
            r.put("size", dst.length());
            call.resolve(r);
        } catch (Exception e) {
            if (tmp != null && tmp.exists()) {
                tmp.delete();
            }
            call.reject(msg(e));
        }
    }

    /** A mappa fájljainak nevei (almappák nélkül). Ha nincs ilyen mappa: üres lista. */
    @PluginMethod
    public void listFiles(PluginCall call) {
        try {
            File dir = new File(call.getString("dir", ""));
            JSArray names = new JSArray();
            File[] list = dir.isDirectory() ? dir.listFiles() : null;
            if (list != null) {
                for (File f : list) {
                    if (f.isFile()) {
                        names.put(f.getName());
                    }
                }
            }
            JSObject r = new JSObject();
            r.put("files", names);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    /** Csak a saját biztonsági másolat (…_elotte_ÉÉÉÉHHNN_ÓÓPPMM.db) törölhető. */
    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            File f = new File(call.getString("path", ""));
            if (!f.getName().matches("^[A-Za-z0-9_]+_elotte_\\d{8}_\\d{6}\\.db$")) {
                call.reject("Csak biztonsági másolat törölhető");
                return;
            }
            if (f.isFile() && !f.delete()) {
                call.reject("A fájl nem törölhető: " + f.getPath());
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    // ------------------------------------------------------------------ megnyitás

    /** Webcím megnyitása az Android alapértelmezett böngészőjében. */
    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            String url = call.getString("url", "").trim();
            String low = url.toLowerCase(Locale.ROOT);
            if (!(low.startsWith("http://") || low.startsWith("https://"))) {
                call.reject("Csak http/https cím nyitható meg: " + url);
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Nincs böngésző, amely megnyitná a címet");
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    // ------------------------------------------------------------------ szöveges fájl írása

    /** UTF-8 szövegfájl írása (a mappát létrehozza, a meglévő fájlt felülírja). */
    @PluginMethod
    public void writeText(PluginCall call) {
        try {
            String path = call.getString("path", "");
            String text = call.getString("text", "");
            if (path == null || path.isEmpty()) { call.reject("Nincs útvonal"); return; }
            File f = new File(path);
            File parent = f.getParentFile();
            if (parent != null) parent.mkdirs();
            try (FileOutputStream os = new FileOutputStream(f)) {
                os.write(text.getBytes(StandardCharsets.UTF_8));
            }
            JSObject o = new JSObject();
            o.put("size", f.length());
            call.resolve(o);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    // ------------------------------------------------------------------ offline (MHTML) cikkek

    // A fájlnévben szereplő azonosító: ..._idHR<14 hexa>_...  (a Vivaldi MHTML Mentő így nevezi el a fájlokat)
    private static final Pattern MHTML_ID = Pattern.compile("_id(HR[0-9a-f]{14})_");
    private final Map<String, String> mhtmlIdx = new HashMap<>();
    private final List<File> mhtmlDirs = new ArrayList<>();
    private String mhtmlRoot = null;
    private long mhtmlSig = 0;

    private long mhtmlSignature(File root) {
        long sig = root.lastModified();
        for (File d : mhtmlDirs) sig = sig * 31 + d.lastModified();
        return sig;
    }

    /** A mappa (és almappái) fájlneveinek beolvasása; csak akkor fut újra, ha a mappa változott (vagy kérik). */
    private synchronized void ensureMhtmlIndex(File root, boolean force) {
        String key = root.getAbsolutePath();
        if (!force && key.equals(mhtmlRoot) && mhtmlSignature(root) == mhtmlSig) return;
        mhtmlIdx.clear();
        mhtmlDirs.clear();
        List<File> stack = new ArrayList<>();
        stack.add(root);
        while (!stack.isEmpty()) {
            File dir = stack.remove(stack.size() - 1);
            mhtmlDirs.add(dir);
            String[] names = dir.list();
            if (names == null) continue;
            for (String n : names) {
                String low = n.toLowerCase(Locale.ROOT);
                if (low.endsWith(".mhtml") || low.endsWith(".mht")) {
                    Matcher m = MHTML_ID.matcher(n);
                    if (m.find()) mhtmlIdx.put(m.group(1), new File(dir, n).getAbsolutePath());
                } else {
                    File sub = new File(dir, n);
                    if (sub.isDirectory()) stack.add(sub);          // csak a nem-MHTML nevekre kell fájlrendszer-lekérdezés
                }
            }
        }
        mhtmlRoot = key;
        mhtmlSig = mhtmlSignature(root);
    }

    /** A megadott azonosítókhoz tartozó MHTML fájlok megkeresése: {exists, count, found: {azonosító: útvonal}}. */
    @PluginMethod
    public void findMhtml(PluginCall call) {
        try {
            String dir = call.getString("dir", "");
            boolean refresh = Boolean.TRUE.equals(call.getBoolean("refresh", false));
            JSArray ids = call.getArray("ids");
            JSObject out = new JSObject();
            JSObject found = new JSObject();
            File root = new File(dir == null ? "" : dir);
            if (!root.isDirectory()) {
                out.put("exists", false);
                out.put("count", 0);
                out.put("found", found);
                call.resolve(out);
                return;
            }
            ensureMhtmlIndex(root, refresh);
            if (ids != null) {
                synchronized (this) {
                    for (int i = 0; i < ids.length(); i++) {
                        String id = ids.getString(i);
                        String p = mhtmlIdx.get(id);
                        if (p != null) found.put(id, p);
                    }
                }
            }
            out.put("exists", true);
            out.put("count", mhtmlIdx.size());
            out.put("found", found);
            call.resolve(out);
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }

    /** Fájl megnyitása az erre alkalmas alkalmazással (MHTML → böngésző), FileProvider-en át. */
    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            String path = call.getString("path", "");
            File f = new File(path == null ? "" : path);
            if (!f.isFile()) { call.reject("Nincs ilyen fájl: " + path); return; }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            String[] types = { "multipart/related", "application/x-mimearchive" };
            for (String t : types) {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, t);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getContext().startActivity(i);
                    call.resolve();
                    return;
                } catch (ActivityNotFoundException ignore) {
                    // a következő típussal próbáljuk
                }
            }
            call.reject("Nincs alkalmazás, amely megnyitná az MHTML fájlt");
        } catch (Exception e) {
            call.reject(msg(e));
        }
    }
}
