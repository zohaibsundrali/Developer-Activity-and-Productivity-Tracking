package com.devtrack.field;
import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
public final class SessionStore extends SQLiteOpenHelper {
    private static SessionStore instance;
    public static synchronized SessionStore get(Context context) { if(instance==null) instance=new SessionStore(context.getApplicationContext()); return instance; }
    private SessionStore(Context context){super(context,"field-work.db",null,1);}
    public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,complete INTEGER NOT NULL,seconds INTEGER NOT NULL,first_at TEXT NOT NULL,recovered INTEGER NOT NULL,body TEXT NOT NULL)");db.execSQL("CREATE UNIQUE INDEX one_active_session ON sessions(complete) WHERE complete=0");}
    public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("A data-preserving upgrade is required.");}
    public synchronized void save(WorkSession session) throws Exception {
        if(session.complete && session.segments.length()==0){getWritableDatabase().delete("sessions","id=? AND owner=?",new String[]{session.id,session.owner});return;}
        ContentValues row=new ContentValues();row.put("id",session.id);row.put("owner",session.owner);row.put("complete",session.complete?1:0);row.put("body",session.saved().toString());row.put("seconds",session.seconds(0));row.put("first_at",session.segments.length()>0?session.segments.getJSONObject(0).getString("start"):WorkSession.iso(session.firstWall));row.put("recovered",session.recovered?1:0);
        SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
        try {
            int updated=db.update("sessions",row,"id=? AND owner=?",new String[]{session.id,session.owner});
            if(updated==0 && db.insertOrThrow("sessions",null,row)<0) throw new IllegalStateException("The phone could not save work. Free storage before tracking.");
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public synchronized WorkSession active() throws Exception {
        try(Cursor cursor=getReadableDatabase().query("sessions",new String[]{"body"},"complete=0",null,null,null,null,"1")){return cursor.moveToFirst()?new WorkSession(new JSONObject(cursor.getString(0))):null;}
    }
    public synchronized int pendingCount(String owner){try(Cursor cursor=getReadableDatabase().rawQuery("SELECT count(*) FROM sessions WHERE owner=? AND complete=1",new String[]{owner})){return cursor.moveToFirst()?cursor.getInt(0):0;}}
    public synchronized List<String> pendingIds(String owner) {
        List<String> ids=new ArrayList<>();try(Cursor cursor=getReadableDatabase().query("sessions",new String[]{"id"},"owner=? AND complete=1",new String[]{owner},null,null,"rowid ASC")){while(cursor.moveToNext())ids.add(cursor.getString(0));}return ids;
    }
    public synchronized WorkSession pendingSession(String id,String owner) throws Exception {
        try(Cursor cursor=getReadableDatabase().query("sessions",new String[]{"body"},"id=? AND owner=? AND complete=1",new String[]{id,owner},null,null,null,"1")){return cursor.moveToFirst()?new WorkSession(new JSONObject(cursor.getString(0))):null;}
    }
    public synchronized List<JSONObject> summaries(String owner) throws Exception {
        List<JSONObject> rows=new ArrayList<>();try(Cursor cursor=getReadableDatabase().query("sessions",new String[]{"id","seconds","first_at","recovered"},"owner=? AND complete=1",new String[]{owner},null,null,"rowid ASC")){while(cursor.moveToNext())rows.add(new JSONObject().put("id",cursor.getString(0)).put("seconds",cursor.getLong(1)).put("first_at",cursor.getString(2)).put("recovered",cursor.getInt(3)==1));}return rows;
    }
    public synchronized void acknowledge(String id,String owner){getWritableDatabase().delete("sessions","id=? AND owner=? AND complete=1",new String[]{id,owner});}
    public synchronized void recoverActive() throws Exception {WorkSession session=active();if(session!=null){session.recover();save(session);}}
}
