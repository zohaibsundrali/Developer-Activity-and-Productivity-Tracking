package com.devtrack.field;
import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TrackingService extends Service implements LocationListener {
    public static final String START="com.devtrack.field.START",PAUSE="com.devtrack.field.PAUSE",RESUME="com.devtrack.field.RESUME",STOP="com.devtrack.field.STOP";
    public static volatile TrackingService instance;
    public static volatile String status="Ready";
    public WorkSession work;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private JSONArray sites=new JSONArray();
    private boolean pingPending=false;
    private long lastSaved=0,lastPing=0;
    public IBinder onBind(Intent intent){return null;}
    public void onCreate(){super.onCreate();instance=this;locationManager=(LocationManager)getSystemService(LOCATION_SERVICE);NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("field-work","Active field work",NotificationManager.IMPORTANCE_LOW));}
    private boolean permitted(){return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private Notification notification(){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,TrackingService.class).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"field-work").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle(work!=null&&work.active?"DevTrack: work and location recording":"DevTrack: work paused").setContentText(status).setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop recording",stop).build()).build();
    }
    public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?STOP:intent.getAction();
        try {
            if(STOP.equals(action)){if(work==null){SessionStore.get(this).recoverActive();stopSelf();}else finish();return START_NOT_STICKY;}
            if(START.equals(action)&&work==null){
                if(!permitted())throw new IllegalStateException("Location permission is required to start field tracking.");
                JSONObject auth=new AuthStore(this).load();if(auth==null||System.currentTimeMillis()-auth.optLong("verified_at",0)>120000)throw new IllegalStateException("Open the app and verify your sign-in before starting.");
                SessionStore store=SessionStore.get(this);store.recoverActive();String owner=AuthStore.identity(auth);if(store.pendingCount(owner)>=100)throw new IllegalStateException("Sync pending sessions before starting another.");
                sites=auth.getJSONObject("context").getJSONArray("sites");work=new WorkSession(owner,System.currentTimeMillis(),SystemClock.elapsedRealtime());store.save(work);status="GPS records only while the work timer is running.";
                startForeground(1,notification());listen();handler.post(ticker);
            } else if(PAUSE.equals(action)&&work!=null){work.pause(SystemClock.elapsedRealtime());SessionStore.get(this).save(work);stopListening();status="Paused: time and GPS recording stopped.";getSystemService(NotificationManager.class).notify(1,notification());}
            else if(RESUME.equals(action)&&work!=null){if(!permitted())throw new IllegalStateException("Restore location permission before resuming.");work.resume(System.currentTimeMillis(),SystemClock.elapsedRealtime());SessionStore.get(this).save(work);if(work.complete){finish();return START_NOT_STICKY;}listen();status="Work and GPS recording resumed.";getSystemService(NotificationManager.class).notify(1,notification());}
        }catch(Exception e){status="Tracking stopped: "+safe(e);stopListening();if(work!=null){try{work.recover();SessionStore.get(this).save(work);}catch(Exception ignored){status="Local storage needs attention. Reopen the app before recording.";}}stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
        return START_NOT_STICKY;
    }
    private void listen(){
        stopListening();if(!permitted())return;
        try {if(locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER,60000,0,this);if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,60000,0,this);}catch(SecurityException e){status="Location permission changed.";finish();}
    }
    private void stopListening(){if(locationManager!=null)locationManager.removeUpdates(this);}
    private final Runnable ticker=new Runnable(){public void run(){
        if(work==null||work.complete)return;
        try {
            if(!permitted()){status="Location permission was revoked. Session stopped.";finish();return;}
            long elapsed=SystemClock.elapsedRealtime();work.tick(elapsed);
            if(elapsed-lastSaved>=15000){SessionStore.get(TrackingService.this).save(work);lastSaved=elapsed;}
            if(work.complete){finish();return;}
            if(elapsed-lastPing>=60000&&!pingPending){lastPing=elapsed;pingPending=true;String sessionId=work.id;FieldApi.NETWORK.execute(()->{
                try {JSONObject result=new FieldApi(TrackingService.this).authenticated("/api/mobile/context","GET",null);handler.post(()->{if(work!=null&&work.id.equals(sessionId)){sites=result.optJSONArray("sites");pingPending=false;}});}
                catch(Exception e){handler.post(()->{pingPending=false;if(work!=null&&work.id.equals(sessionId)){if(e instanceof FieldApi.Failure&&(((FieldApi.Failure)e).status==401||((FieldApi.Failure)e).status==403)){status="Access ended. Session stopped; pending work retained.";finish();}else status="Offline or server unavailable: work remains saved on this phone.";}});}
            });}
            handler.postDelayed(this,1000);
        }catch(Exception e){status="Local work storage needs attention. Recording paused.";stopListening();if(work.active)work.pause(SystemClock.elapsedRealtime());}
    }};
    public void onLocationChanged(Location location){
        if(work==null||!work.active)return;
        long elapsed=SystemClock.elapsedRealtime(),sample=location.getElapsedRealtimeNanos()/1000000;
        float accuracy=location.hasAccuracy()?location.getAccuracy():10000;
        boolean mock=Build.VERSION.SDK_INT>=31?location.isMock():location.isFromMockProvider();
        try {
            if(work.points.length()>0){String at=work.points.getJSONObject(work.points.length()-1).getString("at");if(work.startWall+sample-work.startElapsed-java.time.Instant.parse(at).toEpochMilli()<30000)return;}
            if(!work.addPoint(elapsed,sample,location.getLatitude(),location.getLongitude(),accuracy,mock))return;
            SessionStore.get(this).save(work);String state="No active work sites configured";
            if(sites!=null){boolean any=false;String uncertainty=null;for(int i=0;i<sites.length();i++){JSONObject site=sites.getJSONObject(i);if(!site.getBoolean("active"))continue;any=true;String value=Geofence.classify(location.getLatitude(),location.getLongitude(),accuracy,mock,site.getDouble("latitude"),site.getDouble("longitude"),site.getDouble("radius_m"));if(value.equals("inside")){state="Inside "+site.getString("name");uncertainty=null;break;}if(value.equals("uncertain"))uncertainty="Location uncertain near "+site.getString("name");state="Outside configured work sites";}if(uncertainty!=null)state=uncertainty;else if(!any)state="No active work sites configured";}
            status=state;getSystemService(NotificationManager.class).notify(1,notification());
            if(work.points.length()>=2000){status="Location limit reached. Session stopped; sync before continuing.";finish();}
        }catch(Exception e){status="Location could not be saved. Recording paused.";stopListening();work.pause(elapsed);}
    }
    public void onProviderEnabled(String provider){}
    public void onProviderDisabled(String provider){status="GPS provider is off. Time continues; location samples may be unavailable.";}
    @SuppressWarnings("deprecation") public void onStatusChanged(String provider,int state,Bundle extras){}
    public void finish(){
        stopListening();handler.removeCallbacks(ticker);
        try {if(work!=null){work.finish(SystemClock.elapsedRealtime());SessionStore.get(this).save(work);}stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();FieldApi.NETWORK.execute(()->{try{new FieldApi(this).sync(this);}catch(Exception ignored){/* Pending sessions remain in SQLite for an explicit retry. */}});}
        catch(Exception e){status="Stop needs storage space. Keep the app open and retry Stop.";}
    }
    public void onDestroy(){handler.removeCallbacks(ticker);stopListening();if(work!=null&&!work.complete){try{work.finish(SystemClock.elapsedRealtime());SessionStore.get(this).save(work);}catch(Exception ignored){/* Recovery uses the last successfully persisted checkpoint. */}}instance=null;super.onDestroy();}
    public static String safe(Exception error){return error instanceof FieldApi.Failure||error instanceof IllegalStateException?error.getMessage():"Please retry. Pending work is retained.";}
}
