import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = process.cwd();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertCrLfFrame(text, label) {
  assert.ok(text.endsWith("\r\n\r\n"), `${label} must end with CRLF CRLF`);
  assert.equal(text.replaceAll("\r\n", "").includes("\n"), false, `${label} must not contain bare LF line endings`);
}

function decodeDnsName(message, start) {
  const labels = [];
  let cursor = start;
  let end = -1;
  let hops = 0;
  while (cursor < message.length && hops++ < 64) {
    const length = message[cursor];
    if (length === 0) {
      cursor += 1;
      if (end < 0) end = cursor;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      assert.ok(cursor + 1 < message.length, "truncated DNS compression pointer");
      const pointer = ((length & 0x3f) << 8) | message[cursor + 1];
      if (end < 0) end = cursor + 2;
      cursor = pointer;
      continue;
    }
    assert.ok(cursor + 1 + length <= message.length, "truncated DNS label");
    labels.push(message.subarray(cursor + 1, cursor + 1 + length).toString("utf8"));
    cursor += 1 + length;
  }
  return { name: labels.join("."), end: end < 0 ? cursor : end };
}

function parseDnsRecords(message) {
  assert.ok(message.length >= 12, "DNS packet must include a header");
  const questionCount = message.readUInt16BE(4);
  const answerCount = message.readUInt16BE(6);
  const authorityCount = message.readUInt16BE(8);
  const additionalCount = message.readUInt16BE(10);
  let cursor = 12;
  for (let index = 0; index < questionCount; index += 1) {
    cursor = decodeDnsName(message, cursor).end;
    cursor += 4;
  }
  const records = [];
  const total = answerCount + authorityCount + additionalCount;
  for (let index = 0; index < total; index += 1) {
    const decoded = decodeDnsName(message, cursor);
    cursor = decoded.end;
    assert.ok(cursor + 10 <= message.length, "truncated DNS resource-record header");
    const type = message.readUInt16BE(cursor);
    const klass = message.readUInt16BE(cursor + 2);
    const ttl = message.readUInt32BE(cursor + 4);
    const length = message.readUInt16BE(cursor + 8);
    const dataStart = cursor + 10;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd <= message.length, "truncated DNS resource-record data");
    records.push({ name: decoded.name, type, klass, ttl, data: message.subarray(dataStart, dataEnd) });
    cursor = dataEnd;
  }
  return records;
}

function makeMdnsQuestion(encodeName, name, type = 255) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(name), tail]);
}

function fakeDatagramSocket(captures) {
  return {
    send(payload, port, address, callback) {
      captures.push({ payload: Buffer.from(payload), port, address });
      callback?.(null);
    },
    setMulticastInterface() {},
    dropMembership() {},
    close() {},
  };
}

// Desktop UUID persistence and UPnP identity fields.
const identityModule = require(path.join(root, "desktop", "lan", "identity.cjs"));
const upnpModule = require(path.join(root, "desktop", "lan", "upnp.cjs"));
const identityRoot = mkdtempSync(path.join(os.tmpdir(), "pydroid-lan-identity-"));
try {
  const first = identityModule.loadOrCreateIdentity(identityRoot);
  const second = identityModule.loadOrCreateIdentity(identityRoot);
  assert.equal(second.uuid, first.uuid, "Desktop LAN UUID must persist across service recreation");
  assert.match(first.uuid, /^[0-9a-f-]{36}$/i, "Desktop LAN UUID must use UUID form");
  const xml = upnpModule.makeUpnpDeviceXml({ ...first, ip: "192.168.50.5", port: 43123, version: "1.4.70" });
  assert.match(xml, new RegExp(`<UDN>uuid:${first.uuid}</UDN>`), "device.xml must expose the persistent UDN");
  assert.match(xml, /<friendlyName>PyDroid Node - /, "device.xml must expose the friendly name");
  assert.match(xml, /<presentationURL>http:\/\/192\.168\.50\.5:43123\/<\/presentationURL>/, "device.xml must expose the concise presentation URL");
  assertCrLfFrame(`${xml}\r\n`, "device.xml probe frame");
} finally {
  rmSync(identityRoot, { recursive: true, force: true });
}

// Desktop SSDP protocol framing, ssdp:all expansion and byebye lifecycle.
const ssdpPath = path.join(root, "desktop", "lan", "ssdp.cjs");
const ssdpModule = require(ssdpPath);
const interfaceA = { name: "Ethernet", address: "192.168.50.5", netmask: "255.255.255.0" };
const ssdpConfig = { uuid: "11111111-2222-4333-8444-555555555555", port: 43123 };
const ssdp = new ssdpModule.SsdpService();
ssdp.config = ssdpConfig;
ssdp.interfaces = [interfaceA];
const types = ssdp.types();
assert.deepEqual(types.map((item) => item.target), [
  "upnp:rootdevice",
  `uuid:${ssdpConfig.uuid}`,
  "urn:schemas-upnp-org:device:Basic:1",
], "SSDP must advertise rootdevice, UUID and Basic device targets");
for (const type of types) {
  const alive = ssdp.notifyPayload(interfaceA, type, "ssdp:alive").toString("utf8");
  assertCrLfFrame(alive, `SSDP alive ${type.target}`);
  assert.match(alive, /^NOTIFY \* HTTP\/1\.1\r\n/, "SSDP NOTIFY request line must be valid");
  assert.match(alive, /\r\nLOCATION: http:\/\/192\.168\.50\.5:43123\/upnp\/device\.xml\r\n/, "SSDP alive must include LOCATION");
  assert.ok(alive.includes(`\r\nNT: ${type.target}\r\n`), "SSDP alive must include target NT");
  assert.ok(alive.includes(`\r\nUSN: ${type.usn}\r\n`), "SSDP alive must include matching USN");
}
const ssdpResponses = [];
ssdp.socket = fakeDatagramSocket(ssdpResponses);
const originalRandom = Math.random;
Math.random = () => 0;
try {
  ssdp.handleMessage(Buffer.from(
    "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n",
    "utf8",
  ), { address: "192.168.50.88", port: 49000 });
  await delay(80);
} finally {
  Math.random = originalRandom;
}
assert.equal(ssdpResponses.length, 3, "SSDP ssdp:all must return all three supported target responses");
for (const [index, response] of ssdpResponses.entries()) {
  const text = response.payload.toString("utf8");
  assertCrLfFrame(text, `SSDP search response ${index + 1}`);
  assert.match(text, /^HTTP\/1\.1 200 OK\r\n/, "SSDP search response must start with HTTP 200");
  assert.ok(text.includes(`\r\nST: ${types[index].target}\r\n`), "SSDP response ST must match the advertised target");
  assert.ok(text.includes(`\r\nUSN: ${types[index].usn}\r\n`), "SSDP response USN must match the advertised target");
  assert.match(text, /\r\nLOCATION: http:\/\/192\.168\.50\.5:43123\/upnp\/device\.xml\r\n/, "SSDP response must include LOCATION");
}
const byebyeCaptures = [];
ssdp.socket = fakeDatagramSocket(byebyeCaptures);
ssdp.stop(true);
const byebyes = byebyeCaptures.filter((item) => item.port === ssdpModule.SSDP_PORT);
assert.equal(byebyes.length, 3, "SSDP stop must emit one byebye for each target");
for (const packet of byebyes) {
  const text = packet.payload.toString("utf8");
  assertCrLfFrame(text, "SSDP byebye");
  assert.match(text, /\r\nNTS: ssdp:byebye\r\n/, "SSDP stop must advertise ssdp:byebye");
  assert.doesNotMatch(text, /\r\nLOCATION:/, "SSDP byebye must not advertise a stale LOCATION");
}

// Desktop mDNS A/PTR/SRV/TXT publication, query response and TTL=0 goodbye.
const mdnsPath = path.join(root, "desktop", "lan", "mdns.cjs");
const mdnsModule = require(mdnsPath);
const mdns = new mdnsModule.MdnsService();
mdns.config = { hostname: "pydroid-node-phase10", port: 43123 };
mdns.interfaces = [interfaceA];
const mdnsPacket = mdnsModule.responsePacket(mdns.recordsForInterface(interfaceA, 120));
const mdnsRecords = parseDnsRecords(mdnsPacket);
for (const requiredType of [1, 12, 16, 33]) {
  assert.ok(mdnsRecords.some((record) => record.type === requiredType), `mDNS announcement must include record type ${requiredType}`);
}
assert.ok(mdnsRecords.every((record) => record.ttl === 120), "mDNS live announcement records must use the live TTL");
const queryCaptures = [];
mdns.socket = fakeDatagramSocket(queryCaptures);
mdns.handleMessage(makeMdnsQuestion(mdnsModule.encodeName, "_http._tcp.local", 255));
assert.equal(queryCaptures.length, 1, "mDNS ANY query for _http._tcp.local must receive an announcement response");
const queryRecords = parseDnsRecords(queryCaptures[0].payload);
for (const requiredType of [1, 12, 16, 33]) {
  assert.ok(queryRecords.some((record) => record.type === requiredType), `mDNS query response must include record type ${requiredType}`);
}
const mdnsGoodbyes = [];
mdns.socket = fakeDatagramSocket(mdnsGoodbyes);
mdns.stop(true);
assert.equal(mdnsGoodbyes.length, 1, "mDNS stop must emit one goodbye packet per LAN interface");
assert.ok(parseDnsRecords(mdnsGoodbyes[0].payload).every((record) => record.ttl === 0), "mDNS goodbye records must use TTL=0");

// Desktop network-change restart lifecycle. Patch dependencies only inside this smoke process.
const networkPath = path.join(root, "desktop", "lan", "network.cjs");
const discoveryPath = path.join(root, "desktop", "lan", "LanDiscoveryService.cjs");
const networkModule = require(networkPath);
let activeInterfaces = [interfaceA];
networkModule.getLanInterfaces = () => activeInterfaces;
const ssdpStarts = [];
const mdnsStarts = [];
let failNextSsdp = false;
let failNextMdns = false;
class FakeSsdpService {
  constructor() { this.stopped = false; this.ready = false; ssdpStarts.push(this); }
  start(config, interfaces) {
    this.config = config; this.interfaces = interfaces;
    if (failNextSsdp) { failNextSsdp = false; return Promise.reject(new Error("synthetic SSDP bind failure")); }
    this.ready = true;
    return Promise.resolve({ joined: interfaces.length });
  }
  stop() { this.stopped = true; this.ready = false; }
}
class FakeMdnsService {
  constructor() { this.stopped = false; this.ready = false; mdnsStarts.push(this); }
  start(config, interfaces) {
    this.config = config; this.interfaces = interfaces;
    if (failNextMdns) { failNextMdns = false; return Promise.reject(new Error("synthetic mDNS bind failure")); }
    this.ready = true;
    return Promise.resolve({ joined: interfaces.length });
  }
  stop() { this.stopped = true; this.ready = false; }
}
require.cache[require.resolve(ssdpPath)].exports.SsdpService = FakeSsdpService;
require.cache[require.resolve(mdnsPath)].exports.MdnsService = FakeMdnsService;
delete require.cache[require.resolve(discoveryPath)];
const { LanDiscoveryService } = require(discoveryPath);
const lifecycleRoot = mkdtempSync(path.join(os.tmpdir(), "pydroid-lan-lifecycle-"));
try {
  const lifecycle = new LanDiscoveryService({ userDataRoot: lifecycleRoot, version: "1.4.74" });
  lifecycle.start({ port: 43123 });
  await lifecycle.waitUntilReady(1000);
  assert.equal(ssdpStarts.length, 1, "LAN start must start SSDP once");
  assert.equal(mdnsStarts.length, 1, "LAN start must start mDNS once");
  const firstSsdp = ssdpStarts[0];
  const firstMdns = mdnsStarts[0];
  activeInterfaces = [{ name: "Wi-Fi", address: "192.168.60.7", netmask: "255.255.255.0" }];
  await lifecycle.checkNetwork();
  assert.equal(firstSsdp.stopped, true, "network change must stop the old SSDP service");
  assert.equal(firstMdns.stopped, true, "network change must stop the old mDNS service");
  assert.equal(ssdpStarts.length, 2, "network change must restart SSDP");
  assert.equal(mdnsStarts.length, 2, "network change must restart mDNS");
  assert.equal(lifecycle.primaryAddress(), "192.168.60.7", "network restart must publish the new primary address");
  await lifecycle.checkNetwork();
  assert.equal(ssdpStarts.length, 2, "unchanged healthy network must not restart SSDP");
  assert.equal(mdnsStarts.length, 2, "unchanged healthy network must not restart mDNS");

  failNextSsdp = true;
  activeInterfaces = [{ name: "Wi-Fi", address: "192.168.61.7", netmask: "255.255.255.0" }];
  await lifecycle.checkNetwork();
  assert.match(lifecycle.getStatus().ssdp, /^failed:/, "synthetic SSDP startup failure must be observable");
  assert.equal(lifecycle.getStatus().mdns, "running", "healthy mDNS must stay available when SSDP startup fails");
  const mdnsStartsBeforeRecovery = mdnsStarts.length;
  lifecycle.lastRecoveryAt = 0;
  await lifecycle.checkNetwork();
  assert.equal(lifecycle.getStatus().ssdp, "running", "unchanged network must recover a transient SSDP startup failure");
  assert.equal(mdnsStarts.length, mdnsStartsBeforeRecovery, "SSDP recovery must not restart an already healthy mDNS service");
  assert.equal(lifecycle.getStatus().recoveryAttempts, 1, "recovery attempts must be observable");

  const activeSsdp = ssdpStarts.at(-1);
  const activeMdns = mdnsStarts.at(-1);
  lifecycle.stop();
  assert.equal(activeSsdp.stopped, true, "LAN stop must stop the active SSDP service");
  assert.equal(activeMdns.stopped, true, "LAN stop must stop the active mDNS service");
  assert.equal(lifecycle.getStatus().running, false, "LAN stop must clear running state");
} finally {
  rmSync(lifecycleRoot, { recursive: true, force: true });
}

// Android parity audit plus an optional pure-JDK compile/runtime harness when javac is available.
const javaRoot = path.join(root, "android", "app", "src", "main", "java", "com", "dk", "pydroidflow");
const androidSsdp = readFileSync(path.join(javaRoot, "SsdpService.java"), "utf8");
const androidMdns = readFileSync(path.join(javaRoot, "MdnsService.java"), "utf8");
const androidDiscovery = readFileSync(path.join(javaRoot, "LanDiscoveryService.java"), "utf8");
const androidUpnp = readFileSync(path.join(javaRoot, "UpnpDeviceDescription.java"), "utf8");
assert.match(androidSsdp, /"ssdp:all"\.equals\(requested\)/, "Android SSDP must expand ssdp:all");
assert.match(androidSsdp, /LOCATION: .*\\r\\n/, "Android SSDP response must include LOCATION with CRLF framing");
assert.match(androidSsdp, /ST: .*\\r\\nUSN: /, "Android SSDP response must include ST and USN");
assert.match(androidSsdp, /announce\("ssdp:byebye"\)/, "Android SSDP stop must emit byebye");
assert.match(androidMdns, /records\.add\(record\(host\(\), A, ttl/, "Android mDNS must publish A records");
assert.match(androidMdns, /records\.add\(record\(service\(\), PTR, ttl/, "Android mDNS must publish PTR records");
assert.match(androidMdns, /records\.add\(record\(instance\(\), SRV, ttl/, "Android mDNS must publish SRV records");
assert.match(androidMdns, /records\.add\(record\(instance\(\), TXT, ttl/, "Android mDNS must publish TXT records");
assert.match(androidMdns, /announce\(0\)/, "Android mDNS stop must emit TTL=0 goodbye records");
assert.match(androidDiscovery, /scheduleAtFixedRate\(this::checkNetwork, 5, 5, TimeUnit\.SECONDS\)/, "Android discovery must monitor network changes");
assert.match(androidDiscovery, /if \(ssdp != null\) ssdp\.stop\(\);[\s\S]*if \(mdns != null\) mdns\.stop\(\);/, "Android network restart/stop must release both discovery protocols");
assert.match(androidDiscovery, /RECOVERY_RETRY_MS\s*=\s*15_000L/, "Android discovery must rate-limit transient protocol recovery attempts");
assert.match(androidDiscovery, /if \(ssdp == null\) startSsdp\(\);[\s\S]*if \(mdns == null\) startMdns\(\);/, "Android discovery recovery must restart only failed protocols");
assert.match(androidDiscovery, /recoveryAttempts \+= 1/, "Android discovery recovery attempts must be observable");
assert.match(androidUpnp, /<UDN>uuid:/, "Android device.xml must expose UDN");
assert.match(androidUpnp, /<friendlyName>/, "Android device.xml must expose friendlyName");
assert.match(androidUpnp, /<presentationURL>/, "Android device.xml must expose presentationURL");

const javacProbe = spawnSync("javac", ["-version"], { encoding: "utf8" });
if (!javacProbe.error && javacProbe.status === 0) {
  const javaTemp = mkdtempSync(path.join(os.tmpdir(), "pydroid-lan-java-"));
  try {
    const stubRoot = path.join(javaTemp, "src");
    const outRoot = path.join(javaTemp, "out");
    const writeJava = (relative, content) => {
      const file = path.join(stubRoot, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
      return file;
    };
    const stubs = [
      writeJava("android/util/Log.java", `package android.util; public final class Log { public static int i(String t,String m){return 0;} public static int w(String t,String m){return 0;} public static int w(String t,String m,Throwable e){return 0;} }`),
      writeJava("android/os/Build.java", `package android.os; public final class Build { public static String MODEL = "Phase10 Test"; }`),
      writeJava("android/content/SharedPreferences.java", `package android.content; public interface SharedPreferences { String getString(String key,String fallback); Editor edit(); interface Editor { Editor putString(String key,String value); void apply(); } }`),
      writeJava("android/content/Context.java", `package android.content; public class Context { public static final int MODE_PRIVATE=0; public static final String WIFI_SERVICE="wifi"; public Context getApplicationContext(){return this;} public SharedPreferences getSharedPreferences(String n,int m){return null;} public Object getSystemService(String n){return null;} }`),
      writeJava("android/net/wifi/WifiManager.java", `package android.net.wifi; public class WifiManager { public MulticastLock createMulticastLock(String n){return new MulticastLock();} public static class MulticastLock { public void setReferenceCounted(boolean v){} public void acquire(){} public void release(){} } }`),
      writeJava("org/json/JSONObject.java", `package org.json; import java.util.*; public class JSONObject { private final Map<String,Object> values=new LinkedHashMap<>(); public JSONObject put(String k,Object v){values.put(k,v);return this;} }`),
      writeJava("org/json/JSONArray.java", `package org.json; import java.util.*; public class JSONArray { private final List<Object> values=new ArrayList<>(); public JSONArray put(Object v){values.add(v);return this;} }`),
    ];
    const harness = writeJava("com/dk/pydroidflow/LanDiscoveryProtocolHarness.java", `package com.dk.pydroidflow;
import android.content.*; import java.net.*; import java.lang.reflect.*; import java.util.*;
public final class LanDiscoveryProtocolHarness {
  static final class Prefs implements SharedPreferences { final Map<String,String> values=new HashMap<>(); public String getString(String k,String f){return values.getOrDefault(k,f);} public Editor edit(){return new Editor(){ public Editor putString(String k,String v){values.put(k,v);return this;} public void apply(){} };} }
  static final class Ctx extends Context { final Prefs prefs=new Prefs(); public SharedPreferences getSharedPreferences(String n,int m){return prefs;} }
  static void ok(boolean value,String message){ if(!value) throw new AssertionError(message); }
  static int rrType(byte[] rr){ int c=0; while((rr[c]&255)!=0) c+=1+(rr[c]&255); c++; return ((rr[c]&255)<<8)|(rr[c+1]&255); }
  static long rrTtl(byte[] rr){ int c=0; while((rr[c]&255)!=0) c+=1+(rr[c]&255); c+=5; return ((long)(rr[c]&255)<<24)|((long)(rr[c+1]&255)<<16)|((long)(rr[c+2]&255)<<8)|(long)(rr[c+3]&255); }
  @SuppressWarnings("unchecked") public static void main(String[] args) throws Exception {
    Ctx ctx=new Ctx(); LanDeviceIdentity a=LanDeviceIdentity.load(ctx), b=LanDeviceIdentity.load(ctx); ok(a.uuid.equals(b.uuid),"uuid persistence");
    String xml=UpnpDeviceDescription.build("192.168.50.5",43123,a); ok(xml.contains("<UDN>uuid:"+a.uuid+"</UDN>"),"UDN"); ok(xml.contains("<friendlyName>"+a.friendlyName+"</friendlyName>"),"friendlyName"); ok(xml.contains("<presentationURL>http://192.168.50.5:43123/</presentationURL>"),"presentationURL");
    SsdpService ssdp=new SsdpService(a,43123,List.of()); Method targets=SsdpService.class.getDeclaredMethod("targets"); targets.setAccessible(true); List<Object> targetList=(List<Object>)targets.invoke(ssdp); ok(targetList.size()==3,"SSDP target count"); Set<String> sts=new HashSet<>(); for(Object t:targetList){ Field st=t.getClass().getDeclaredField("st"); st.setAccessible(true); Field usn=t.getClass().getDeclaredField("usn"); usn.setAccessible(true); String sv=(String)st.get(t), uv=(String)usn.get(t); sts.add(sv); ok(uv.contains("uuid:"+a.uuid),"SSDP USN uuid"); } ok(sts.contains("upnp:rootdevice")&&sts.contains("urn:schemas-upnp-org:device:Basic:1")&&sts.contains("uuid:"+a.uuid),"SSDP targets");
    LanNetworkInterfaceManager.Entry entry=new LanNetworkInterfaceManager.Entry(null,(Inet4Address)InetAddress.getByName("192.168.50.5"),(short)24); MdnsService mdns=new MdnsService(a,43123,List.of(entry)); Method records=MdnsService.class.getDeclaredMethod("records",LanNetworkInterfaceManager.Entry.class,int.class); records.setAccessible(true); List<byte[]> live=(List<byte[]>)records.invoke(mdns,entry,120); Set<Integer> types=new HashSet<>(); for(byte[] rr:live){types.add(rrType(rr));ok(rrTtl(rr)==120,"mDNS live TTL");} ok(types.contains(1)&&types.contains(12)&&types.contains(16)&&types.contains(33),"mDNS record types"); List<byte[]> bye=(List<byte[]>)records.invoke(mdns,entry,0); for(byte[] rr:bye) ok(rrTtl(rr)==0,"mDNS goodbye TTL");
    System.out.println("Android LAN protocol harness passed");
  }
}`);
    mkdirSync(outRoot, { recursive: true });
    const sources = [
      ...stubs,
      path.join(javaRoot, "LanNetworkInterfaceManager.java"),
      path.join(javaRoot, "LanDeviceIdentity.java"),
      path.join(javaRoot, "UpnpDeviceDescription.java"),
      path.join(javaRoot, "SsdpService.java"),
      path.join(javaRoot, "MdnsService.java"),
      path.join(javaRoot, "LanDiscoveryService.java"),
      harness,
    ];
    const compile = spawnSync("javac", ["-encoding", "UTF-8", "-d", outRoot, ...sources], { encoding: "utf8" });
    assert.equal(compile.status, 0, `Android LAN Java compile failed:\n${compile.stderr || compile.stdout}`);
    const run = spawnSync("java", ["-cp", outRoot, "com.dk.pydroidflow.LanDiscoveryProtocolHarness"], { encoding: "utf8" });
    assert.equal(run.status, 0, `Android LAN Java protocol harness failed:\n${run.stderr || run.stdout}`);
    assert.match(run.stdout, /Android LAN protocol harness passed/, "Android LAN Java harness did not report success");
  } finally {
    rmSync(javaTemp, { recursive: true, force: true });
  }
} else {
  console.warn("Android LAN Java compile/runtime harness skipped because javac is unavailable; static parity audit still passed.");
}

console.log("LAN discovery lifecycle smoke passed: SSDP/UPnP/mDNS identity, restart and goodbye contracts are protected.");
