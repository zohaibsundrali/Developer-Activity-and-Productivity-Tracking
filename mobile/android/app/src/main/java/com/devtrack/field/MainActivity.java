package com.devtrack.field;
import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.*;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.widget.*;
import org.json.JSONObject;
public final class MainActivity extends Activity {
    private LinearLayout content;
    private TextView status,timer,pending;
    private EditText workspace,email,password;
    private Button start,pause,resume,stop,sync,signout;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean busy=false;
    private String owner=null,exportOwner=null;
    private LinearLayout pendingList;
    private int shownPending=-1;
    private final java.util.Set<String> exported=new java.util.HashSet<>();
    protected void onCreate(Bundle saved){super.onCreate(saved);try{if(TrackingService.instance==null)SessionStore.get(this).recoverActive();}catch(Exception e){TrackingService.status="Saved work needs attention before tracking.";}show();}
    private TextView text(String value,int size){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(0xFF0F172A);view.setPadding(0,12,0,12);content.addView(view);return view;}
    private EditText input(String hint,int type){EditText field=new EditText(this);field.setHint(hint);field.setInputType(type);field.setSingleLine(true);field.setTextColor(0xFF0F172A);content.addView(field);return field;}
    private Button button(String label,View.OnClickListener action){Button view=new Button(this);view.setText(label);view.setOnClickListener(action);content.addView(view);return view;}
    private void show(){
        handler.removeCallbacks(refresh);ScrollView scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(32,24,32,24);content.setBackgroundColor(0xFFF8FAFC);scroll.addView(content);setContentView(scroll);
        if(Build.VERSION.SDK_INT>=30)scroll.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        text("DevTrack Field",28);
        JSONObject auth=null;try{auth=new AuthStore(this).load();}catch(Exception e){text("Secure sign-in could not be read. Sign in again; saved work remains on this phone.",14);new AuthStore(this).clear();}
        if(auth==null){owner=null;exported.clear();text("Sign in to your workday timer",18);workspace=input("Workspace address",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);workspace.setText("https://devtrack-blush.vercel.app");email=input("Work email",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);password=input("Password",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);password.setSaveEnabled(false);password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);status=text("",14);
            button("Sign in",view->{if(busy)return;busy=true;String base=workspace.getText().toString(),mail=email.getText().toString(),pass=password.getText().toString();password.setText("");status.setText("Signing in…");FieldApi.NETWORK.execute(()->{try{new FieldApi(this).login(base,mail,pass);runOnUiThread(()->{busy=false;show();});}catch(Exception e){runOnUiThread(()->{busy=false;status.setText(TrackingService.safe(e));});}});});return;
        }
        try{owner=AuthStore.identity(auth);}catch(Exception e){new AuthStore(this).clear();show();return;}
        shownPending=-1;
        text("Workday timer",20);timer=text("00:00:00",36);status=text(TrackingService.status,14);pending=text("",14);
        text("Location records only while the timer runs, including when this app is in the background. Pause and Stop end location capture. Your organization’s authorized monitoring viewers can see uploaded history. Offline work stays on this phone until you stop and sync.",14);
        start=button("Start work and location recording",view->new AlertDialog.Builder(this).setTitle("Start work and location recording?").setMessage("GPS samples will be saved while your work timer runs. A persistent notification lets you stop at any time. No location is recorded while paused or stopped.").setPositiveButton("Start",(dialog,which)->requestStart()).setNegativeButton("Cancel",null).show());
        pause=button("Pause time and GPS",view->command(TrackingService.PAUSE));resume=button("Resume time and GPS",view->command(TrackingService.RESUME));stop=button("Stop and save session",view->{if(TrackingService.instance!=null)TrackingService.instance.finish();});
        sync=button("Sync pending sessions",view->{if(busy)return;busy=true;status.setText("Syncing completed sessions…");FieldApi.NETWORK.execute(()->{try{int count=new FieldApi(this).sync(this);runOnUiThread(()->{busy=false;TrackingService.status="Synced "+count+" completed sessions.";});}catch(Exception e){runOnUiThread(()->{busy=false;TrackingService.status=TrackingService.safe(e);});}});});
        signout=button("Sign out",view->{if(TrackingService.instance!=null)TrackingService.instance.finish();new AuthStore(this).clear();busy=false;show();});
        button("Export pending work and GPS backup",view->{if(busy)return;exportOwner=owner;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"devtrack-pending-work.json");startActivityForResult(intent,31);});
        pendingList=new LinearLayout(this);pendingList.setOrientation(LinearLayout.VERTICAL);content.addView(pendingList);
        text("Unallocated mobile time is non-billable and enters your timesheet after sync. It still needs normal approval. GPS is an estimate; geofence results do not automatically change attendance or pay.",13);
        handler.post(refresh);
    }
    private void command(String action){if(TrackingService.instance!=null)startService(new Intent(this,TrackingService.class).setAction(action));}
    private void requestStart(){
        if(busy)return;
        if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},21);return;}
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},22);return;}
        busy=true;String captured=owner;status.setText("Checking current work access…");FieldApi.NETWORK.execute(()->{try{new FieldApi(this).authenticated("/api/mobile/context","GET",null);runOnUiThread(()->{busy=false;if(!captured.equals(owner))return;try{startForegroundService(new Intent(this,TrackingService.class).setAction(TrackingService.START));}catch(Exception e){TrackingService.status="Could not start recording. Keep the app visible and check permissions.";}});}catch(Exception e){runOnUiThread(()->{busy=false;TrackingService.status=TrackingService.safe(e);});}});
    }
    public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);boolean granted=false;for(int result:results)granted|=result==PackageManager.PERMISSION_GRANTED;if(granted)requestStart();else TrackingService.status="Permission was declined. No tracking started. Enable it in Android settings to use field tracking.";}
    private final Runnable refresh=new Runnable(){public void run(){if(owner==null)return;TrackingService service=TrackingService.instance;WorkSession work=service==null?null:service.work;
        boolean running=work!=null;long seconds=running?work.seconds(SystemClock.elapsedRealtime()):0;timer.setText(String.format(java.util.Locale.ROOT,"%02d:%02d:%02d",seconds/3600,seconds/60%60,seconds%60));if(!busy)status.setText(TrackingService.status);
        start.setEnabled(!busy&&!running);pause.setEnabled(!busy&&running&&work.active);resume.setEnabled(!busy&&running&&!work.active&&!work.complete);stop.setEnabled(running);sync.setEnabled(!busy);signout.setEnabled(!busy);
        try{int count=SessionStore.get(MainActivity.this).pendingCount(owner);pending.setText(count+" completed sessions waiting to sync");if(count!=shownPending){shownPending=count;showPending();}}catch(Exception e){pending.setText("Pending work could not be read. Do not clear app storage.");}
        handler.postDelayed(this,1000);
    }};
    private void showPending() throws Exception {
        pendingList.removeAllViews();String captured=owner;
        for(JSONObject row:SessionStore.get(this).summaries(captured)){
            String id=row.getString("id");TextView label=new TextView(this);label.setText(row.getString("first_at")+" · "+String.format(java.util.Locale.ROOT,"%.2f",row.getLong("seconds")/3600.0)+" hours"+(row.getBoolean("recovered")?" · Recovered":""));label.setTextColor(0xFF0F172A);label.setPadding(0,16,0,8);pendingList.addView(label);
            Button discard=new Button(this);discard.setText("Remove phone copy after backup");discard.setEnabled(exported.contains(id));discard.setOnClickListener(view->new AlertDialog.Builder(this).setTitle("Remove this pending phone copy?").setMessage("Use this only after saving a backup and resolving the hours with your manager. It removes the phone copy; it does not change any server timesheet.").setPositiveButton("Remove phone copy",(dialog,which)->{if(captured.equals(owner)&&exported.contains(id)){SessionStore.get(this).acknowledge(id,captured);shownPending=-1;}}).setNegativeButton("Keep",null).show());pendingList.addView(discard);
        }
    }
    protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=31||result!=RESULT_OK||data==null||data.getData()==null)return;
        String captured=exportOwner;android.net.Uri destination=data.getData();if(captured==null||!captured.equals(owner))return;busy=true;
        FieldApi.NETWORK.execute(()->{java.util.Set<String> saved=new java.util.HashSet<>();try{
            JSONObject current=new AuthStore(this).load();if(current==null||!captured.equals(AuthStore.identity(current)))throw new IllegalStateException("Sign-in changed. Backup cancelled.");
            try(java.io.OutputStream output=getContentResolver().openOutputStream(destination,"w")){if(output==null)throw new IllegalStateException("Backup file could not be opened.");java.io.Writer writer=new java.io.OutputStreamWriter(output,java.nio.charset.StandardCharsets.UTF_8);writer.write("{\"format\":\"devtrack-pending-v1\",\"sessions\":[");boolean first=true;
                for(String id:SessionStore.get(this).pendingIds(captured)){JSONObject latest=new AuthStore(this).load();if(latest==null||!captured.equals(AuthStore.identity(latest)))throw new IllegalStateException("Sign-in changed. Backup is incomplete.");WorkSession work=SessionStore.get(this).pendingSession(id,captured);if(work==null)continue;if(!first)writer.write(",");writer.write(work.payload().toString());first=false;saved.add(id);}writer.write("]}");writer.flush();
            }
            runOnUiThread(()->{busy=false;if(captured.equals(owner)){exported.addAll(saved);shownPending=-1;TrackingService.status="Backup saved. Keep it until the pending hours are resolved.";}});
        }catch(Exception e){runOnUiThread(()->{busy=false;TrackingService.status="Backup could not be completed. Pending work remains on this phone.";});}});
    }
    protected void onDestroy(){handler.removeCallbacks(refresh);super.onDestroy();}
}
