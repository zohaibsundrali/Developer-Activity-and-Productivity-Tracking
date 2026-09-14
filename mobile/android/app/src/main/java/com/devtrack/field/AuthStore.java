package com.devtrack.field;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
/** Tokens are encrypted with a non-exportable Android Keystore key. No fallback plaintext. */
public final class AuthStore {
    private static final String ALIAS="devtrack-field-auth-v1";
    private static long revision=0;
    private final SharedPreferences prefs;
    public AuthStore(Context context){prefs=context.getApplicationContext().getSharedPreferences("field-auth",Context.MODE_PRIVATE);}
    public static synchronized long revision(){return revision;}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)){KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();}
        return (SecretKey)store.getKey(ALIAS,null);
    }
    public JSONObject load() throws Exception { synchronized(AuthStore.class){String raw=prefs.getString("encrypted",null);if(raw==null)return null;JSONObject box=new JSONObject(raw);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(box.getString("iv"),Base64.NO_WRAP)));return new JSONObject(new String(cipher.doFinal(Base64.decode(box.getString("data"),Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8));} }
    public void save(JSONObject value,long expectedRevision,boolean newLogin) throws Exception { synchronized(AuthStore.class){if(revision!=expectedRevision)throw new IllegalStateException("The sign-in changed. Retry from the current account.");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());JSONObject box=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(cipher.doFinal(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP));if(!prefs.edit().putString("encrypted",box.toString()).commit())throw new IllegalStateException("Secure sign-in storage is unavailable.");if(newLogin)revision++;} }
    public void clear(){synchronized(AuthStore.class){revision++;prefs.edit().remove("encrypted").commit();}}
    public static String identity(JSONObject auth) throws Exception {JSONObject c=auth.getJSONObject("context");return auth.getString("base")+":"+c.getString("organization_id")+":"+c.getString("user_type")+":"+c.getString("user_id")+":"+auth.getString("auth_user_id");}
}
