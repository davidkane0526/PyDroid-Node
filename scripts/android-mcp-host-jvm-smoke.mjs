import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "pydroid-mcp-jvm-"));
const stubDir = path.join(temp, "com", "getcapacitor");
mkdirSync(stubDir, { recursive: true });
writeFileSync(path.join(stubDir, "JSObject.java"), `package com.getcapacitor;\npublic class JSObject extends java.util.HashMap<String,Object> { public JSObject() { super(); } }\n`);
writeFileSync(path.join(stubDir, "PluginCall.java"), `package com.getcapacitor;\nimport java.util.Map;\nimport java.util.concurrent.CompletableFuture;\npublic class PluginCall {\n  private final Map<String,String> values; public final CompletableFuture<JSObject> result = new CompletableFuture<>();\n  public PluginCall() { this(java.util.Map.of()); } public PluginCall(Map<String,String> values) { this.values = values; }\n  public String getString(String key, String fallback) { return values.getOrDefault(key, fallback); }\n  public void resolve(JSObject value) { result.complete(value); }\n  public void reject(String message) { result.completeExceptionally(new RuntimeException(message)); }\n  public void reject(String message, Throwable cause) { result.completeExceptionally(new RuntimeException(message, cause)); }\n}\n`);
const harness = path.join(temp, "AndroidMcpServiceSmoke.java");
writeFileSync(harness, `package com.dk.pydroidflow;\n\nimport com.getcapacitor.JSObject;\nimport com.getcapacitor.PluginCall;\nimport java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\nimport java.util.Map;\nimport java.util.concurrent.ExecutorService;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.TimeUnit;\n\npublic final class AndroidMcpServiceSmoke {\n  public static void main(String[] args) throws Exception {\n    ExecutorService executor = Executors.newCachedThreadPool();\n    AndroidMcpService service = new AndroidMcpService(executor);\n    service.setListener((requestId, body, method, name, version) -> service.complete(new PluginCall(Map.of(\"requestId\", requestId, \"response\", \"{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":1,\\\"result\\\":{\\\"method\\\":\\\"\" + method + \"\\\",\\\"version\\\":\\\"\" + version + \"\\\"}}\"))));\n    try {\n      PluginCall start = new PluginCall(); service.start(start); JSObject info = start.result.get(5, TimeUnit.SECONDS);\n      String token = String.valueOf(info.get(\"token\")); if (((Number) info.get(\"port\")).intValue() != 8766) throw new AssertionError(info);\n      HttpClient client = HttpClient.newHttpClient(); URI uri = URI.create(\"http://127.0.0.1:8766/mcp\");\n      HttpRequest unauthorized = HttpRequest.newBuilder(uri).header(\"MCP-Protocol-Version\", \"2026-07-28\").header(\"Mcp-Method\", \"tools/list\").POST(HttpRequest.BodyPublishers.ofString(\"{}\")).build();\n      if (client.send(unauthorized, HttpResponse.BodyHandlers.ofString()).statusCode() != 401) throw new AssertionError(\"unauthorized request accepted\");\n      HttpRequest request = HttpRequest.newBuilder(uri).header(\"Authorization\", \"Bearer \" + token).header(\"MCP-Protocol-Version\", \"2026-07-28\").header(\"Mcp-Method\", \"tools/list\").POST(HttpRequest.BodyPublishers.ofString(\"{\\\"jsonrpc\\\":\\\"2.0\\\"}\")).build();\n      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());\n      if (response.statusCode() != 200 || !response.body().contains(\"tools/list\") || !response.body().contains(\"2026-07-28\")) throw new AssertionError(response.body());\n      PluginCall reuse = new PluginCall(); service.start(reuse); JSObject reuseInfo = reuse.result.get(5, TimeUnit.SECONDS); if (!token.equals(String.valueOf(reuseInfo.get(\"token\")))) throw new AssertionError(\"repeated start replaced the active token\");\n      PluginCall stop = new PluginCall(); service.stop(stop); stop.result.get(5, TimeUnit.SECONDS);\n      System.out.println(\"Android MCP service JVM E2E passed on 8766\");\n    } finally { service.close(); executor.shutdownNow(); }\n  }\n}\n`, "utf8");

const sources = [
  path.join(root, "android/app/src/main/java/com/dk/pydroidflow/McpServer.java"),
  path.join(root, "android/app/src/main/java/com/dk/pydroidflow/LanNetworkInterfaceManager.java"),
  path.join(root, "android/app/src/main/java/com/dk/pydroidflow/host/AndroidMcpService.java"),
  path.join(stubDir, "JSObject.java"), path.join(stubDir, "PluginCall.java"), harness,
];
try {
  const compile = spawnSync("javac", ["-d", temp, ...sources], { encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const run = spawnSync("java", ["-cp", temp, "com.dk.pydroidflow.AndroidMcpServiceSmoke"], { encoding: "utf8", timeout: 15000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Android MCP service JVM E2E passed on 8766/);
  process.stdout.write(run.stdout);
} finally { rmSync(temp, { recursive: true, force: true }); }
