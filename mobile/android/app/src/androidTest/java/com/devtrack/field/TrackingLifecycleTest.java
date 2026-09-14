package com.devtrack.field;
import android.Manifest;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
@RunWith(AndroidJUnit4.class)
public class TrackingLifecycleTest {
 @Test public void foregroundTrackingPausesAndStopsWithoutLosingPendingWork() throws Exception {
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();
  for(String permission:new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.POST_NOTIFICATIONS})instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  AuthStore authStore=new AuthStore(context);authStore.clear();
  JSONObject profile=new JSONObject().put("organization_id","99100000-0000-0000-0000-000000000001").put("user_id","99100000-0000-0000-0000-000000000011").put("user_type","developer").put("sites",new JSONArray()).put("can_record",true);
  // Fixture-only sign-in; network fails locally while the real service runs.
  JSONObject auth=new JSONObject().put("base","https://127.0.0.1:1").put("supabase_url","https://127.0.0.1:1").put("public_key","fixture").put("access_token","fixture.token.value").put("refresh_token","fixture").put("expires_at",System.currentTimeMillis()/1000+3600).put("auth_user_id","fixture-user").put("context",profile).put("verified_at",System.currentTimeMillis());
  authStore.save(auth,AuthStore.revision(),true);String owner=AuthStore.identity(auth);
  for(String old:SessionStore.get(context).pendingIds(owner))SessionStore.get(context).acknowledge(old,owner);
  Activity activity=instrumentation.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  try {
   instrumentation.runOnMainSync(()->context.startForegroundService(new Intent(context,TrackingService.class).setAction(TrackingService.START)));
   long deadline=SystemClock.elapsedRealtime()+10000;while((TrackingService.instance==null||TrackingService.instance.work==null)&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(50);
   assertNotNull("Foreground service did not start",TrackingService.instance);assertNotNull(TrackingService.instance.work);SystemClock.sleep(1200);
   instrumentation.runOnMainSync(()->{Location sample=new Location("fixture");sample.setLatitude(31.5);sample.setLongitude(74.3);sample.setAccuracy(15);sample.setTime(System.currentTimeMillis());sample.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());sample.setMock(true);TrackingService.instance.onLocationChanged(sample);});
   instrumentation.runOnMainSync(()->context.startService(new Intent(context,TrackingService.class).setAction(TrackingService.PAUSE)));instrumentation.waitForIdleSync();
   WorkSession paused=SessionStore.get(context).active();assertNotNull(paused);assertFalse(paused.active);assertEquals(1,paused.points.length());long pausedSeconds=paused.seconds(0);
   SystemClock.sleep(1200);assertEquals(pausedSeconds,SessionStore.get(context).active().seconds(SystemClock.elapsedRealtime()));
   instrumentation.runOnMainSync(()->{Location sample=new Location("fixture");sample.setLatitude(32);sample.setLongitude(75);sample.setAccuracy(15);sample.setTime(System.currentTimeMillis());sample.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());TrackingService.instance.onLocationChanged(sample);});
   assertEquals("Pause must not capture GPS",1,SessionStore.get(context).active().points.length());
   instrumentation.runOnMainSync(()->context.startService(new Intent(context,TrackingService.class).setAction(TrackingService.RESUME)));instrumentation.waitForIdleSync();SystemClock.sleep(1200);
   instrumentation.runOnMainSync(()->TrackingService.instance.finish());instrumentation.waitForIdleSync();
   assertNull(SessionStore.get(context).active());assertEquals(1,SessionStore.get(context).pendingCount(owner));WorkSession saved=SessionStore.get(context).pendingSession(SessionStore.get(context).pendingIds(owner).get(0),owner);assertTrue(saved.complete);assertEquals(2,saved.segments.length());assertEquals(1,saved.points.length());
  }finally{instrumentation.runOnMainSync(()->{if(TrackingService.instance!=null)TrackingService.instance.finish();activity.finish();});authStore.clear();}
 }
}
