import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const javaRoot = path.join(root, "android", "app", "src", "main", "java", "com", "dk", "pydroidflow");
const javacProbe = spawnSync("javac", ["-version"], { encoding: "utf8" });
if (javacProbe.error || javacProbe.status !== 0) {
  console.warn("Android Remote host JVM smoke skipped because javac is unavailable.");
  process.exit(0);
}

const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-android-remote-host-"));
try {
  const src = path.join(temp, "src");
  const out = path.join(temp, "out");
  mkdirSync(out, { recursive: true });
  const writeJava = (relative, content) => {
    const file = path.join(src, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    return file;
  };

  const stubs = [
    writeJava("android/content/res/AssetManager.java", `package android.content.res; import java.io.*; import java.nio.charset.StandardCharsets; public class AssetManager { public InputStream open(String path) throws IOException { String value; if ("public/index.html".equals(path)) value="<html><body><div id=\\\"root\\\"></div><script src=\\\"/assets/main.js\\\"></script></body></html>"; else if ("public/assets/main.js".equals(path)) value="console.log('PyDroid Android Remote host live asset');"; else throw new FileNotFoundException(path); return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)); } }`),
    writeJava("android/content/Context.java", `package android.content; import android.content.res.AssetManager; import java.io.File; public class Context { private final AssetManager assets=new AssetManager(); private final File files=new File(System.getProperty("java.io.tmpdir"),"pydroid-android-remote-jvm"); public Context getApplicationContext(){return this;} public AssetManager getAssets(){return assets;} public File getFilesDir(){files.mkdirs();return files;} }`),
    writeJava("android/os/Debug.java", `package android.os; public final class Debug { public static int getPss(){return 1234;} }`),
    writeJava("android/util/Base64.java", `package android.util; public final class Base64 { public static final int URL_SAFE=8, NO_WRAP=2, NO_PADDING=1; public static String encodeToString(byte[] value,int flags){return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(value);} }`),
    writeJava("android/util/Log.java", `package android.util; public final class Log { public static int w(String t,String m,Throwable x){return 0;} public static int e(String t,String m,Throwable x){return 0;} }`),
    writeJava("com/chaquo/python/PyObject.java", `package com.chaquo.python; public class PyObject { public PyObject callAttr(String n,Object... a){return new PyObject();} public String toString(){return "{}";} }`),
    writeJava("com/chaquo/python/Python.java", `package com.chaquo.python; public class Python { private static final Python I=new Python(); public static Python getInstance(){return I;} public PyObject getModule(String n){return new PyObject();} }`),
    writeJava("org/json/JSONArray.java", `package org.json; import java.util.*; public class JSONArray { private final List<Object> values=new ArrayList<>(); public JSONArray(){} public JSONArray(java.util.Collection<?> c){values.addAll(c);} public JSONArray put(Object v){values.add(v);return this;} public int length(){return values.size();} public Object get(int i){return values.get(i);} public String toString(){return values.toString();} }`),
    writeJava("org/json/JSONObject.java", `package org.json; import java.util.*; public class JSONObject { public static final Object NULL=new Object(); private final Map<String,Object> values=new LinkedHashMap<>(); public JSONObject(){} public JSONObject(String text){} public JSONObject put(String k,Object v){values.put(k,v);return this;} public String optString(String k,String d){Object v=values.get(k);return v==null?d:String.valueOf(v);} public long optLong(String k,long d){Object v=values.get(k);return v instanceof Number?((Number)v).longValue():d;} public JSONArray optJSONArray(String k){Object v=values.get(k);return v instanceof JSONArray?(JSONArray)v:null;} public JSONObject optJSONObject(String k){Object v=values.get(k);return v instanceof JSONObject?(JSONObject)v:null;} public Object opt(String k){return values.get(k);} public String getString(String k){return String.valueOf(values.get(k));} public int getInt(String k){return ((Number)values.get(k)).intValue();} public boolean getBoolean(String k){return (Boolean)values.get(k);} public JSONArray getJSONArray(String k){return (JSONArray)values.get(k);} public JSONObject getJSONObject(String k){return (JSONObject)values.get(k);} public boolean isNull(String k){Object v=values.get(k);return v==null||v==NULL;} public String toString(){return values.toString();} }`),
    writeJava("com/getcapacitor/JSObject.java", `package com.getcapacitor; public class JSObject extends org.json.JSONObject { public JSObject(){} @Override public JSObject put(String k,Object v){super.put(k,v);return this;} }`),
    writeJava("com/getcapacitor/PluginCall.java", `package com.getcapacitor; import java.util.concurrent.*; public class PluginCall { private final Boolean requirePin; private final CountDownLatch done=new CountDownLatch(1); private volatile JSObject result; private volatile Exception error; public PluginCall(Boolean requirePin){this.requirePin=requirePin;} public boolean getBoolean(String key,boolean fallback){return requirePin==null?fallback:requirePin.booleanValue();} public void resolve(JSObject value){result=value;done.countDown();} public void reject(String message,Exception exception){error=exception==null?new Exception(message):exception;done.countDown();} public boolean await(long ms)throws InterruptedException{return done.await(ms,TimeUnit.MILLISECONDS);} public boolean rejected(){return error!=null;} public JSObject result(){return result;} }`),
    writeJava("com/dk/pydroidflow/AgentSecretStore.java", `package com.dk.pydroidflow; import android.content.Context; final class AgentSecretStore { static String load(Context c){return "";} }`),
    writeJava("com/dk/pydroidflow/PythonExecutionController.java", `package com.dk.pydroidflow; import java.util.*; import java.util.concurrent.*; final class PythonExecutionController { static final long DEFAULT_TIMEOUT_MS=60000; static final class ControlledExecution{} enum Phase{RUNNING} static final class ExecutionSnapshot { String executionId=""; String workspaceId=""; String workspaceLabel=""; String clientId=""; String source=""; Phase phase=Phase.RUNNING; Object startedAt=null; } ControlledExecution submit(String a,long b,String c,String d,String e,String f,Callable<String> g){return new ControlledExecution();} String await(ControlledExecution e){return "{}";} boolean cancel(String id){return true;} List<ExecutionSnapshot> snapshots(){return List.of();} int runningCount(){return 0;} int queuedCount(){return 0;} int capacity(){return 1;} }`),
    writeJava("com/dk/pydroidflow/LanDiscoveryService.java", `package com.dk.pydroidflow; import android.content.Context; import java.util.*; import org.json.*; final class LanDiscoveryService { private final int port; LanDiscoveryService(Context c,int p){port=p;} void start(){} void stop(){} String primaryAddress(){return "192.168.50.5";} List<String> urls(){return List.of("http://192.168.50.5:"+port+"/");} JSONObject status(){return new JSONObject().put("interfaces",new JSONArray().put(new JSONObject().put("name","wlan0").put("address","192.168.50.5"))).put("ssdp","running").put("mdns","running");} String deviceXml(String ip){return "<root><presentationURL>http://"+(ip==null?primaryAddress():ip)+":"+port+"/</presentationURL></root>";} }`),
  ];

  const harness = writeJava("com/dk/pydroidflow/AndroidRemoteHostHarness.java", `package com.dk.pydroidflow; import android.content.Context; import com.getcapacitor.PluginCall; import java.io.*; import java.net.*; import java.nio.charset.StandardCharsets; import java.util.concurrent.*; public final class AndroidRemoteHostHarness { static void ok(boolean v,String m){if(!v)throw new AssertionError(m);} static String get(String path)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8765"+path).openConnection(); c.setConnectTimeout(2500);c.setReadTimeout(2500); try{ok(c.getResponseCode()==200,"HTTP "+c.getResponseCode()+" "+path); return new String(c.getInputStream().readAllBytes(),StandardCharsets.UTF_8);} finally{c.disconnect();}} static boolean closedEventually(long timeoutMs)throws Exception{long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeoutMs); do{try{get("/health");}catch(Exception expected){return true;} Thread.sleep(25);}while(System.nanoTime()<deadline); return false;} public static void main(String[] a)throws Exception{Context context=new Context(); ExecutorService py=Executors.newSingleThreadExecutor(); ExecutorService req=Executors.newCachedThreadPool(); RemoteWorkflowServer direct=null; AndroidRemoteService service=null; try{direct=RemoteWorkflowServer.start(context,py,req,new PythonExecutionController(),false); ok("OK".equals(get("/health").trim()),"direct health"); ok(get("/").contains("id=\\\"root\\\""),"direct shell"); ok(get("/assets/main.js").length()>32,"direct asset"); ok(direct.connectionInfo().getInt("port")==8765,"direct port"); direct.stop(); direct=null; ok(closedEventually(1000),"direct stop releases port"); service=new AndroidRemoteService(context,py,req,new PythonExecutionController()); PluginCall start=new PluginCall(true); service.start(start); ok(start.await(5000)&&!start.rejected(),"service start"); ok(start.result().getInt("port")==8765,"service port"); ok("OK".equals(get("/health").trim()),"service health"); PluginCall reuse=new PluginCall(false); service.start(reuse); ok(reuse.await(5000)&&!reuse.rejected(),"running service reuse"); ok(reuse.result().getInt("port")==8765,"reuse port"); PluginCall stop=new PluginCall(null); service.stop(stop); ok(stop.await(2000)&&!stop.rejected(),"service stop"); ok(closedEventually(1000),"service stop releases port"); System.out.println("Android Remote host JVM E2E passed: real HTTP start, asset serving, reuse and stop");} finally{if(direct!=null)direct.stop(); if(service!=null)service.close(); py.shutdownNow(); req.shutdownNow();}} }`);

  const sources = [
    ...stubs,
    path.join(javaRoot, "RemoteWorkflowServer.java"),
    path.join(javaRoot, "host", "AndroidRemoteService.java"),
    harness,
  ];
  const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", out, ...sources], { encoding: "utf8" });
  assert.equal(compile.status, 0, `Android Remote host JVM compile failed:\n${compile.stderr || compile.stdout}`);
  const run = spawnSync("java", ["-cp", out, "com.dk.pydroidflow.AndroidRemoteHostHarness"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(run.status, 0, `Android Remote host JVM E2E failed:\n${run.stderr || run.stdout}`);
  assert.match(run.stdout, /Android Remote host JVM E2E passed: real HTTP start, asset serving, reuse and stop/, "Android Remote host JVM harness did not report live-host success");
  console.log(run.stdout.trim());
} finally {
  rmSync(temp, { recursive: true, force: true });
}
