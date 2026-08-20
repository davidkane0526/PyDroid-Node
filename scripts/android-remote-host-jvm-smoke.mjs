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
    writeJava("android/content/res/AssetManager.java", `package android.content.res; import java.io.*; import java.nio.charset.StandardCharsets; public class AssetManager { public InputStream open(String path) throws IOException { String value; if ("public/index.html".equals(path)) value="<html><body><div id=\\\"root\\\"></div><script src=\\\"/assets/main.js\\\"></script></body></html>"; else if ("public/assets/main.js".equals(path)) value="console.log('PyDroid Android Remote host readiness asset');"; else throw new FileNotFoundException(path); return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)); } }`),
    writeJava("android/content/Context.java", `package android.content; import android.content.res.AssetManager; import java.io.File; public class Context { private final AssetManager assets=new AssetManager(); private final File files=new File(System.getProperty("java.io.tmpdir"),"pydroid-android-remote-jvm"); public Context getApplicationContext(){return this;} public AssetManager getAssets(){return assets;} public File getFilesDir(){files.mkdirs();return files;} }`),
    writeJava("android/os/Debug.java", `package android.os; public final class Debug { public static int getPss(){return 1234;} }`),
    writeJava("com/chaquo/python/PyObject.java", `package com.chaquo.python; public class PyObject { public PyObject callAttr(String n,Object... a){return new PyObject();} public String toString(){return "{}";} }`),
    writeJava("com/chaquo/python/Python.java", `package com.chaquo.python; public class Python { private static final Python I=new Python(); public static Python getInstance(){return I;} public PyObject getModule(String n){return new PyObject();} }`),
    writeJava("org/json/JSONArray.java", `package org.json; import java.util.*; public class JSONArray { private final List<Object> values=new ArrayList<>(); public JSONArray(){} public JSONArray(java.util.Collection<?> c){values.addAll(c);} public JSONArray put(Object v){values.add(v);return this;} public int length(){return values.size();} public Object get(int i){return values.get(i);} public String toString(){return values.toString();} }`),
    writeJava("org/json/JSONObject.java", `package org.json; import java.util.*; public class JSONObject { public static final Object NULL=new Object(); private final Map<String,Object> values=new LinkedHashMap<>(); public JSONObject(){} public JSONObject(String text){} public JSONObject put(String k,Object v){values.put(k,v);return this;} public String optString(String k,String d){Object v=values.get(k);return v==null?d:String.valueOf(v);} public long optLong(String k,long d){Object v=values.get(k);return v instanceof Number?((Number)v).longValue():d;} public JSONArray optJSONArray(String k){Object v=values.get(k);return v instanceof JSONArray?(JSONArray)v:null;} public JSONObject optJSONObject(String k){Object v=values.get(k);return v instanceof JSONObject?(JSONObject)v:null;} public Object opt(String k){return values.get(k);} public String getString(String k){return String.valueOf(values.get(k));} public int getInt(String k){return ((Number)values.get(k)).intValue();} public boolean getBoolean(String k){return (Boolean)values.get(k);} public JSONArray getJSONArray(String k){return (JSONArray)values.get(k);} public JSONObject getJSONObject(String k){return (JSONObject)values.get(k);} public boolean isNull(String k){Object v=values.get(k);return v==null||v==NULL;} public String toString(){return values.toString();} }`),
    writeJava("com/dk/pydroidflow/AgentSecretStore.java", `package com.dk.pydroidflow; import android.content.Context; final class AgentSecretStore { static String load(Context c){return "";} }`),
    writeJava("com/dk/pydroidflow/PythonExecutionController.java", `package com.dk.pydroidflow; import java.util.*; import java.util.concurrent.*; final class PythonExecutionController { static final long DEFAULT_TIMEOUT_MS=60000; static final class ControlledExecution{} enum Phase{RUNNING} static final class ExecutionSnapshot { String executionId=""; String workspaceId=""; String workspaceLabel=""; String clientId=""; String source=""; Phase phase=Phase.RUNNING; Object startedAt=null; } ControlledExecution submit(String a,long b,String c,String d,String e,String f,Callable<String> g){return new ControlledExecution();} String await(ControlledExecution e){return "{}";} boolean cancel(String id){return true;} List<ExecutionSnapshot> snapshots(){return List.of();} int runningCount(){return 0;} int queuedCount(){return 0;} int capacity(){return 1;} }`),
    writeJava("com/dk/pydroidflow/LanDiscoveryService.java", `package com.dk.pydroidflow; import android.content.Context; import java.util.*; import org.json.*; final class LanDiscoveryService { private final int port; LanDiscoveryService(Context c,int p){port=p;} void start(){} void stop(){} String primaryAddress(){return "192.168.50.5";} List<String> urls(){return List.of("http://192.168.50.5:"+port+"/");} JSONObject status(){return new JSONObject().put("interfaces",new JSONArray().put(new JSONObject().put("name","wlan0").put("address","192.168.50.5"))).put("ssdp","running").put("mdns","running");} String deviceXml(String ip){return "<root><presentationURL>http://"+(ip==null?primaryAddress():ip)+":"+port+"/</presentationURL></root>";} }`),
  ];

  const harness = writeJava("com/dk/pydroidflow/AndroidRemoteHostHarness.java", `package com.dk.pydroidflow; import android.content.Context; import java.io.*; import java.net.*; import java.nio.charset.StandardCharsets; import java.util.concurrent.*; import org.json.*; public final class AndroidRemoteHostHarness { static void ok(boolean v,String m){if(!v)throw new AssertionError(m);} static String get(String path)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:8765"+path).openConnection(); c.setConnectTimeout(2500);c.setReadTimeout(2500); try{ok(c.getResponseCode()==200,"HTTP "+c.getResponseCode()+" "+path); return new String(c.getInputStream().readAllBytes(),StandardCharsets.UTF_8);} finally{c.disconnect();}} public static void main(String[] a)throws Exception{ExecutorService py=Executors.newSingleThreadExecutor(); ExecutorService req=Executors.newCachedThreadPool(); RemoteWorkflowServer server=null; try{server=RemoteWorkflowServer.start(new Context(),py,req,new PythonExecutionController(),true); ok("OK".equals(get("/health").trim()),"health"); ok(get("/").contains("id=\\\"root\\\""),"shell"); ok(get("/assets/main.js").length()>32,"asset"); JSONObject info=server.connectionInfo(); ok(info.getInt("port")==8765,"port"); JSONObject discovery=info.getJSONObject("discovery"); ok("running".equals(discovery.getString("ssdp")),"ssdp"); ok("running".equals(discovery.getString("mdns")),"mdns"); System.out.println("Android Remote host JVM E2E passed");} finally{if(server!=null)server.stop();py.shutdownNow();req.shutdownNow();}} }`);

  const sources = [
    ...stubs,
    path.join(javaRoot, "RemoteAccessGuard.java"),
    path.join(javaRoot, "RemoteWorkflowServer.java"),
    harness,
  ];
  const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", out, ...sources], { encoding: "utf8" });
  assert.equal(compile.status, 0, `Android Remote host JVM compile failed:\n${compile.stderr || compile.stdout}`);
  const run = spawnSync("java", ["-cp", out, "com.dk.pydroidflow.AndroidRemoteHostHarness"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(run.status, 0, `Android Remote host JVM E2E failed:\n${run.stderr || run.stdout}`);
  assert.match(run.stdout, /Android Remote host JVM E2E passed/, "Android Remote host JVM harness did not report success");
  console.log(run.stdout.trim());
} finally {
  rmSync(temp, { recursive: true, force: true });
}
