package com.devtrack.field;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.UUID;

/** Local work clock uses elapsed time; stopped/pause intervals never accrue work. */
public final class WorkSession {
    public final String id, owner;
    public final JSONArray segments, points;
    public boolean active, complete, recovered;
    public long startWall, startElapsed, lastWall, firstWall;
    public String segmentId;
    public WorkSession(String owner, long wall, long elapsed) {
        this.id = UUID.randomUUID().toString(); this.owner = owner;
        segments = new JSONArray(); points = new JSONArray(); firstWall = wall;
        resume(wall, elapsed);
    }
    public WorkSession(JSONObject saved) throws Exception {
        id=saved.getString("id"); owner=saved.getString("owner"); segments=saved.getJSONArray("segments"); points=saved.getJSONArray("points");
        active=saved.getBoolean("active"); complete=saved.getBoolean("complete"); recovered=saved.getBoolean("recovered");
        startWall=saved.getLong("startWall"); startElapsed=saved.getLong("startElapsed"); lastWall=saved.getLong("lastWall"); firstWall=saved.getLong("firstWall"); segmentId=saved.getString("segmentId");
    }
    public void resume(long wall, long elapsed) {
        if (complete || active) return;
        if (segments.length() >= 100 || wall-firstWall >= 86400000L) { complete=true; return; }
        startWall=Math.max(wall,lastWall); lastWall=startWall; startElapsed=elapsed; segmentId=UUID.randomUUID().toString(); active=true;
    }
    public void tick(long elapsed) {
        if (!active) return;
        if (elapsed<startElapsed) { recover(); return; }
        lastWall=Math.min(firstWall+86400000L,startWall+(elapsed-startElapsed));
        if (lastWall>=firstWall+86400000L) finish(elapsed);
    }
    private void closeSegment() {
        if (!active) return;
        try {
            if (lastWall-startWall>=1000) segments.put(new JSONObject().put("id",segmentId).put("start",iso(startWall)).put("end",iso(lastWall)));
            else while(points.length()>0 && Instant.parse(points.getJSONObject(points.length()-1).getString("at")).toEpochMilli()>=startWall) points.remove(points.length()-1);
        } catch(Exception e) { throw new IllegalStateException("Local work could not be saved."); }
        active=false;
    }
    public void pause(long elapsed) { if(active && elapsed<startElapsed){recover();return;} if(active) { lastWall=Math.min(firstWall+86400000L,startWall+Math.max(0,elapsed-startElapsed)); closeSegment(); } }
    public void finish(long elapsed) { pause(elapsed); complete=true; }
    public void recover() { closeSegment(); complete=true; recovered=true; }
    public boolean addPoint(long elapsed, long sampleElapsed, double lat, double lon, float accuracy, boolean mock) {
        if(!active || sampleElapsed<startElapsed || sampleElapsed>elapsed || elapsed-sampleElapsed>120000 || points.length()>=2000 || !Double.isFinite(lat) || !Double.isFinite(lon) || !Float.isFinite(accuracy) || Math.abs(lat)>90 || Math.abs(lon)>180 || accuracy<0 || accuracy>10000) return false;
        tick(elapsed); if(!active) return false;
        long at=startWall+(sampleElapsed-startElapsed);
        try {
            if(points.length()>0 && at<=Instant.parse(points.getJSONObject(points.length()-1).getString("at")).toEpochMilli()) return false;
            points.put(new JSONObject().put("at",iso(at)).put("lat",lat).put("lon",lon).put("accuracy",accuracy).put("mock",mock)); return true;
        } catch(Exception e) { throw new IllegalStateException("Location sample could not be saved."); }
    }
    public long seconds(long elapsed) {
        long total=0;
        try { for(int i=0;i<segments.length();i++){JSONObject s=segments.getJSONObject(i); total+=(Instant.parse(s.getString("end")).toEpochMilli()-Instant.parse(s.getString("start")).toEpochMilli())/1000;} } catch(Exception e){throw new IllegalStateException("Local work is unreadable.");}
        return total+(active?Math.max(0,Math.min(firstWall+86400000L,startWall+Math.max(0,elapsed-startElapsed))-startWall)/1000:0);
    }
    public JSONObject saved() throws Exception { return new JSONObject().put("id",id).put("owner",owner).put("segments",segments).put("points",points).put("active",active).put("complete",complete).put("recovered",recovered).put("startWall",startWall).put("startElapsed",startElapsed).put("lastWall",lastWall).put("firstWall",firstWall).put("segmentId",segmentId); }
    public JSONObject payload() throws Exception { if(!complete || segments.length()==0) throw new IllegalStateException("Stop this session before syncing."); return new JSONObject().put("id",id).put("segments",segments).put("points",points).put("recovered",recovered); }
    public static String iso(long value) { return Instant.ofEpochMilli(value).toString(); }
}
