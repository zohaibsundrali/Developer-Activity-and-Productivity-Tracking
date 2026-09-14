package com.devtrack.field;
import android.content.Context;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
public final class FieldApi {
    public static final ExecutorService NETWORK=Executors.newSingleThreadExecutor();
    public static final class Failure extends Exception { public final int status; public Failure(String text,int status){super(text);this.status=status;} }
    private final AuthStore authStore;
    public FieldApi(Context context){authStore=new AuthStore(context);}
    public static String origin(String text) throws Exception {URI url=new URI(text.trim());if(!"https".equals(url.getScheme())||url.getHost()==null||url.getUserInfo()!=null||url.getQuery()!=null||url.getFragment()!=null||!(url.getPath().isEmpty()||url.getPath().equals("/")))throw new Failure("Use your HTTPS workspace address without a path.",400);return new URI("https",null,url.getHost(),url.getPort(),null,null,null).toString();}
    private JSONObject request(String url,String method,JSONObject body,String access,String key) throws Exception {
        if((access!=null&&!access.matches("[A-Za-z0-9._~-]+"))||(key!=null&&!key.matches("[A-Za-z0-9._~-]+")))throw new Failure("Invalid authentication response.",401);
        HttpURLConnection connection=(HttpURLConnection)new URI(url).toURL().openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(12000);connection.setReadTimeout(15000);connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");
        if(access!=null)connection.setRequestProperty("Authorization","Bearer "+access);if(key!=null)connection.setRequestProperty("apikey",key);
        try {
            if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);try(java.io.OutputStream out=connection.getOutputStream()){out.write(bytes);}}
            int status=connection.getResponseCode();if(status>=300&&status<400)throw new Failure("The workspace moved. Use its current HTTPS address.",status);
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(input!=null)try(InputStream stream=input){byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(bytes.size()+count>1000000)throw new Failure("Server response is too large.",503);bytes.write(buffer,0,count);}}
            JSONObject result;try{result=new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));}catch(Exception e){throw new Failure("The server response could not be read.",503);}
            if(status>=400){String message=result.optString("error","");if(!(result.opt("error") instanceof String)||message.length()>250||message.isEmpty())message=status==401||status==403?"Sign-in or access is no longer valid.":"Request failed. Pending work is retained.";throw new Failure(message,status);}
            return result;
        } finally {connection.disconnect();}
    }
    public void login(String workspace,String email,String password) throws Exception {
        long revision=AuthStore.revision();String base=origin(workspace);
        JSONObject config=request(base+"/api/mobile/config","GET",null,null,null);
        String supabase=origin(config.getString("supabase_url")),key=config.getString("public_key");
        JSONObject session=request(supabase+"/auth/v1/token?grant_type=password","POST",new JSONObject().put("email",email.trim()).put("password",password),null,key);
        String access=session.getString("access_token"),refresh=session.getString("refresh_token"),uid=session.getJSONObject("user").getString("id");
        JSONObject context=request(base+"/api/mobile/context","GET",null,access,null);verifyContext(context);
        JSONObject auth=new JSONObject().put("base",base).put("supabase_url",supabase).put("public_key",key).put("access_token",access).put("refresh_token",refresh).put("expires_at",System.currentTimeMillis()/1000+session.getLong("expires_in")).put("auth_user_id",uid).put("context",context).put("verified_at",System.currentTimeMillis());
        authStore.save(auth,revision,true);
    }
    private void verifyContext(JSONObject context) throws Exception {
        if(!context.optBoolean("success")||!context.optBoolean("can_record")||!context.getString("organization_id").matches("[0-9a-fA-F-]{36}")||!context.getString("user_id").matches("[0-9a-fA-F-]{36}")||!(context.getString("user_type").equals("admin")||context.getString("user_type").equals("developer"))||context.getJSONArray("sites").length()>100)throw new Failure("This account cannot record mobile work.",403);
    }
    public JSONObject authenticated(String path,String method,JSONObject body) throws Exception {
        long revision=AuthStore.revision();JSONObject auth=authStore.load();if(auth==null)throw new Failure("Sign in first.",401);
        if(auth.getLong("expires_at")<System.currentTimeMillis()/1000+60){
            JSONObject session=request(auth.getString("supabase_url")+"/auth/v1/token?grant_type=refresh_token","POST",new JSONObject().put("refresh_token",auth.getString("refresh_token")),null,auth.getString("public_key"));
            if(!session.getJSONObject("user").getString("id").equals(auth.getString("auth_user_id")))throw new Failure("Sign-in identity changed.",401);
            auth.put("access_token",session.getString("access_token")).put("refresh_token",session.getString("refresh_token")).put("expires_at",System.currentTimeMillis()/1000+session.getLong("expires_in"));authStore.save(auth,revision,false);
        }
        if(AuthStore.revision()!=revision)throw new Failure("Sign-in changed.",401);
        JSONObject result=request(auth.getString("base")+path,method,body,auth.getString("access_token"),null);
        if(AuthStore.revision()!=revision)throw new Failure("Sign-in changed.",401);
        if(path.equals("/api/mobile/context")){verifyContext(result);JSONObject old=auth.getJSONObject("context");if(!result.getString("organization_id").equals(old.getString("organization_id"))||!result.getString("user_id").equals(old.getString("user_id"))||!result.getString("user_type").equals(old.getString("user_type")))throw new Failure("Work identity changed. Sign in again.",401);auth.put("context",result).put("verified_at",System.currentTimeMillis());authStore.save(auth,revision,false);}
        return result;
    }
    public int sync(Context context) throws Exception {
        JSONObject auth=authStore.load();if(auth==null)throw new Failure("Sign in first.",401);String owner=AuthStore.identity(auth);long revision=AuthStore.revision();int synced=0;
        for(String pendingId:SessionStore.get(context).pendingIds(owner)){
            WorkSession work=SessionStore.get(context).pendingSession(pendingId,owner);if(work==null)continue;if(!work.owner.equals(owner)||!work.id.equals(pendingId))throw new Failure("Pending identity could not be verified.",409);
            if(AuthStore.revision()!=revision)throw new Failure("Sign-in changed.",401);
            JSONObject receipt=authenticated("/api/mobile/sessions","POST",work.payload());JSONObject who=auth.getJSONObject("context");
            if(!receipt.optBoolean("success")||!receipt.getString("id").equals(work.id)||!receipt.getString("organization_id").equals(who.getString("organization_id"))||!receipt.getString("user_id").equals(who.getString("user_id"))||!receipt.getString("user_type").equals(who.getString("user_type"))||receipt.getLong("work_seconds")!=work.seconds(0)||!(receipt.opt("unchanged") instanceof Boolean))throw new Failure("Upload receipt did not match. Pending work is retained.",503);
            if(AuthStore.revision()!=revision)throw new Failure("Sign-in changed.",401);
            SessionStore.get(context).acknowledge(work.id,owner);synced++;
        }
        return synced;
    }
}
