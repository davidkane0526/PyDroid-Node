const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns").promises;
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
let remoteServer = null;
let remotePin = null;
const remoteTokens = new Set();
const SMB_FILE_PATTERN = /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i;

function probeSmbHost(address, timeout = 380) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port: 445 });
    const finish = (open) => { socket.destroy(); resolve(open ? address : null); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function netViewListHosts() {
  // Windows 原生 `net view` 列出局域网 SMB 主机（含主机名），作为设备发现的权威来源。
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); net view`], { windowsHide: true });
    const chunks = [];
    let settled = false;
    const finish = (hosts = []) => { if (settled) return; settled = true; clearTimeout(timer); resolve(hosts); };
    // 现代 Windows 浏览服务已废弃：net view 要么秒回要么报错 6118 卡死，1.2s 内见分晓
    const timer = setTimeout(() => { child.kill(); finish([]); }, 1200);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", () => finish([]));
    child.once("close", () => {
      const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
      const hosts = [];
      for (const line of lines) {
        const trimmed = line.trim();
        const share = trimmed.match(/^\\\\?([A-Za-z0-9_.-]{1,15})(\s{2,}|$)/);
        if (share) { hosts.push(share[1]); continue; }
      }
      resolve([...new Set(hosts)]);
    });
  });
}

function netbiosName(address) {
  // nbtstat -A 通过 NetBIOS 节点状态查询（UDP 137）获取主机名。
  // 名称列固定 15 字符：短名称后补空格，占满 15 字符的名称与 <type> 之间无空格。
  // nbtstat 输出为 GBK（中文系统把 UNIQUE/GROUP/状态列都本地化），node 直接 UTF-8 解码会乱码，
  // 因此用 latin1 保留原始字节，在字节层面匹配 ASCII "UNIQUE" 或 GBK“唯一”(CE A8 D2 BB)。
  if (!/^[0-9.]+$/.test(String(address || ""))) return Promise.resolve("");
  return new Promise((resolve) => {
    const child = spawn("nbtstat.exe", ["-A", address], { windowsHide: true });
    const chunks = [];
    let settled = false;
    const finish = (name = "") => { if (settled) return; settled = true; clearTimeout(timer); resolve(name); };
    // nbtstat 对每个网络接口串行查询，多接口机器（vEthernet/WLAN/以太网并存）累计可达 4~5s，超时需留足余量
    const timer = setTimeout(() => { child.kill(); finish(""); }, 5500);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", () => finish(""));
    child.once("close", () => {
      const text = Buffer.concat(chunks).toString("latin1");
      const gbkUnique = String.fromCharCode(0xCE, 0xA8, 0xD2, 0xBB); // GBK“唯一”
      let name = "";
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z0-9_.-]{1,15})\s*<(\d{2})>\s+(.*)$/);
        if (!match) continue;
        const tag = match[2];
        if (tag !== "00" && tag !== "20") continue;
        const typeText = match[3].replace(/^\s+/, "");
        const isUnique = /^UNIQUE/i.test(typeText) || typeText.startsWith(gbkUnique);
        if (!isUnique) continue;
        if (tag === "00") { name = match[1]; break; }
        if (!name) name = match[1]; // 无 <00> 条目时以 <20>（文件服务器服务）兜底
      }
      finish(name);
    });
  });
}

async function scanSubnetForSmb() {
  const localAddrs = new Set(mdnsLocalIfaceAddrs()); // 排除本机接口 IP
  // 虚拟网卡（Hyper-V vEthernet / VMware / VirtualBox）子网里通常只有网关，整段扫描纯浪费
  const VIRTUAL_IFACE = /vEthernet|vmware|virtual|hyper-v|bluetooth|loopback/i;
  const buildCandidates = (filterVirtual) => {
    const candidates = new Set();
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      if (filterVirtual && VIRTUAL_IFACE.test(name)) continue;
      for (const entry of entries ?? []) {
        if (entry.family !== "IPv4" || entry.internal) continue;
        const octets = entry.address.split(".").map(Number);
        if (octets.length !== 4) continue;
        for (let suffix = 1; suffix < 255; suffix++) candidates.add(`${octets[0]}.${octets[1]}.${octets[2]}.${suffix}`);
      }
    }
    return [...candidates].filter((address) => !localAddrs.has(address));
  };
  let addresses = buildCandidates(true);
  if (!addresses.length) addresses = buildCandidates(false); // 全是虚拟网卡时回退，避免漏扫
  const found = [];
  for (let offset = 0; offset < addresses.length; offset += 48) {
    const batch = await Promise.all(addresses.slice(offset, offset + 48).map((address) => probeSmbHost(address)));
    found.push(...batch.filter(Boolean));
  }
  return found;
}

// ---- mDNS 发现（零依赖，UDP 5353 组播）----
// Windows 10+（启用网络发现）与主流 NAS（avahi/bonjour）会响应 mDNS，
// 用于补齐 net view / nbtstat 都解析不到的设备名称。
const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const MDNS_QTYPE_PTR = 12;
const MDNS_QTYPE_SRV = 33;
const MDNS_QTYPE_A = 1;

function mdnsEncodeName(name) {
  const parts = String(name).replace(/\.$/, "").split(".");
  const chunks = [];
  for (const part of parts) {
    const label = Buffer.from(part, "ascii");
    chunks.push(Buffer.from([label.length]), label);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function mdnsDecodeName(message, offset) {
  const labels = [];
  let cursor = offset;
  let end = -1;
  let hops = 0;
  while (hops++ < 64) {
    const length = message[cursor];
    if (length === 0) { cursor += 1; if (end === -1) end = cursor; break; }
    if ((length & 0xC0) === 0xC0) {
      const pointer = ((length & 0x3F) << 8) | message[cursor + 1];
      if (end === -1) end = cursor + 2;
      cursor = pointer;
      continue;
    }
    labels.push(message.subarray(cursor + 1, cursor + 1 + length).toString("ascii"));
    cursor += 1 + length;
  }
  return { name: labels.join("."), end: end === -1 ? cursor : end };
}

function mdnsBuildQuery(name, qtype) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // ID（mDNS 通常为 0）
  header.writeUInt16BE(0, 2); // flags：标准查询
  header.writeUInt16BE(1, 4); // QDCOUNT
  const nameBytes = mdnsEncodeName(name);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(qtype, 0);
  question.writeUInt16BE(1, 2); // QCLASS IN
  return Buffer.concat([header, nameBytes, question]);
}

function mdnsParseResponse(message, onRecord) {
  if (message.length < 12) return;
  const questions = message.readUInt16BE(4);
  const answers = message.readUInt16BE(6);
  let cursor = 12;
  for (let i = 0; i < questions; i++) cursor = mdnsDecodeName(message, cursor).end + 4;
  for (let i = 0; i < answers; i++) {
    const owner = mdnsDecodeName(message, cursor);
    cursor = owner.end;
    if (cursor + 10 > message.length) break;
    const type = message.readUInt16BE(cursor);
    const rdlength = message.readUInt16BE(cursor + 8);
    const rdataStart = cursor + 10;
    let data = null;
    let rdataEnd = rdataStart + rdlength;
    if (type === MDNS_QTYPE_PTR) {
      const target = mdnsDecodeName(message, rdataStart);
      data = target.name;
      rdataEnd = target.end;
    } else if (type === MDNS_QTYPE_SRV) {
      if (rdataStart + 6 <= message.length) {
        const target = mdnsDecodeName(message, rdataStart + 6);
        data = { port: message.readUInt16BE(rdataStart + 4), target: target.name };
        rdataEnd = target.end;
      }
    } else if (type === MDNS_QTYPE_A && rdlength === 4 && rdataStart + 4 <= message.length) {
      data = [message[rdataStart], message[rdataStart + 1], message[rdataStart + 2], message[rdataStart + 3]].join(".");
    }
    cursor = rdataEnd;
    onRecord(owner.name, type, data);
  }
}

function mdnsUnescape(name) {
  return String(name).replace(/\\(.)/g, "$1");
}

function mdnsLocalIfaceAddrs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function mdnsSmbServers(timeoutMs = 2500) {
  // 正向发现：查询 _smb._tcp.local. 的 PTR，经 SRV/A 记录关联出 { name, address }。
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const instances = new Map(); // 实例全名 -> { target, port }
    const ptrNames = new Set();  // PTR 指向的实例全名
    const targetIps = new Map(); // SRV 目标主机 -> [IP]
    let settled = false;
    const collect = () => {
      const results = new Map();
      for (const instanceName of ptrNames) {
        const info = instances.get(instanceName);
        if (!info || !info.target) continue;
        const ips = targetIps.get(info.target) || [];
        for (const ip of ips) {
          if (!/^[0-9.]+$/.test(ip)) continue;
          if (!results.has(ip)) results.set(ip, { name: mdnsUnescape(String(instanceName).split(".")[0] || ip), address: ip });
        }
      }
      return [...results.values()];
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(collect());
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("error", () => finish());
    socket.on("message", (message) => {
      try {
        mdnsParseResponse(message, (owner, type, data) => {
          if (type === MDNS_QTYPE_PTR && owner.toLowerCase() === "_smb._tcp.local") {
            ptrNames.add(String(data));
          } else if (type === MDNS_QTYPE_SRV) {
            const info = instances.get(owner) || { target: "", port: 0 };
            info.target = data.target;
            info.port = data.port;
            instances.set(owner, info);
          } else if (type === MDNS_QTYPE_A) {
            const list = targetIps.get(owner) || [];
            if (!list.includes(data)) list.push(data);
            targetIps.set(owner, list);
          }
        });
      } catch {}
    });
    const ifaces = mdnsLocalIfaceAddrs();
    if (!ifaces.length) { finish(); return; }
    socket.bind(0, () => {
      for (const iface of ifaces) { try { socket.addMembership(MDNS_ADDR, iface); } catch {} }
      const query = mdnsBuildQuery("_smb._tcp.local.", MDNS_QTYPE_PTR);
      const send = () => { for (const iface of ifaces) { try { socket.send(query, 0, query.length, MDNS_PORT, MDNS_ADDR); } catch {} } };
      send();
      setTimeout(send, 900); // 重发一次，提高可靠性
    });
  });
}

function mdnsReverseLookup(address, timeoutMs = 600) {
  // 反向发现：查询 <反转IP>.in-addr.arpa. 的 PTR，把已知 IP 映射回主机名。
  if (!/^[0-9.]+$/.test(String(address || ""))) return Promise.resolve("");
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;
    const finish = (name = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(name);
    };
    const timer = setTimeout(() => finish(""), timeoutMs);
    socket.on("error", () => finish(""));
    socket.on("message", (message) => {
      try {
        mdnsParseResponse(message, (owner, type, data) => {
          if (type === MDNS_QTYPE_PTR && /in-addr\.arpa\.?$/i.test(owner)) {
            finish(mdnsUnescape(String(data).split(".")[0] || ""));
          }
        });
      } catch {}
    });
    const ifaces = mdnsLocalIfaceAddrs();
    if (!ifaces.length) { finish(""); return; }
    socket.bind(0, () => {
      for (const iface of ifaces) { try { socket.addMembership(MDNS_ADDR, iface); } catch {} }
      const query = mdnsBuildQuery(address.split(".").reverse().join(".") + ".in-addr.arpa.", MDNS_QTYPE_PTR);
      const send = () => { for (const iface of ifaces) { try { socket.send(query, 0, query.length, MDNS_PORT, MDNS_ADDR); } catch {} } };
      send();
      setTimeout(send, 250);
    });
  });
}

async function resolveSmbName(address) {
  // 快速路径优先：反向 DNS（~0ms）→ mDNS 反向（≤600ms）→ nbtstat（多接口机器 4~5s，最后兜底）
  let name = address;
  try { name = (await dns.reverse(address))[0] || address; } catch {}
  if (name === address) name = (await mdnsReverseLookup(address)) || address;
  if (name === address) name = (await netbiosName(address)) || address;
  return name;
}

async function discoverSmbServers() {
  const found = [];
  const seen = new Set();
  // 1) `net view` 权威发现与 445 端口扫描并行（net view 在现代 Windows 常返回空，2.5s 内见分晓）
  const [netViewHosts, scanned] = await Promise.all([netViewListHosts(), scanSubnetForSmb()]);
  for (const host of netViewHosts) {
    if (seen.has(host.toLocaleLowerCase())) continue;
    seen.add(host.toLocaleLowerCase());
    found.push({ address: host, name: host, shares: [] });
  }
  // 2) 名称解析：nbtstat（NetBIOS UDP 137）高并发批次；mDNS 正向发现同时启动，结果随后合并
  //    解析链：反向 DNS → mDNS 反向（≤600ms）→ nbtstat（4~5s）
  const mdnsPromise = mdnsSmbServers();
  const names = new Map();
  const pending = scanned.filter((address) => !seen.has(address));
  for (let offset = 0; offset < pending.length; offset += 32) {
    const batch = pending.slice(offset, offset + 32);
    const resolved = await Promise.all(batch.map((address) => resolveSmbName(address)));
    batch.forEach((address, index) => names.set(address, resolved[index]));
  }
  for (const address of pending) {
    seen.add(address);
    found.push({ address, name: names.get(address) || address, shares: [] });
  }
  // 3) 对首次 nbtstat 解析失败的设备重试（UDP 137 偶发丢包），与共享枚举并行
  const retryTargets = pending.filter((address) => names.get(address) === address);
  const retryPromise = retryTargets.length
    ? Promise.all(retryTargets.map(async (address) => {
        const name = await netbiosName(address);
        if (name) names.set(address, name);
      }))
    : Promise.resolve();
  // 4) 共享枚举并行批次（Get-ChildItem \\ip 对无凭据主机快速失败，避免串行累积等待）
  const shareCandidates = found.map((server) => server.address);
  const sharesByAddress = new Map();
  for (let offset = 0; offset < shareCandidates.length; offset += 16) {
    const batch = shareCandidates.slice(offset, offset + 16);
    const results = await Promise.all(batch.map((address) => netViewShares(address).catch(() => [])));
    batch.forEach((address, index) => sharesByAddress.set(address, results[index]));
  }
  await retryPromise;
  for (const server of found) {
    server.shares = sharesByAddress.get(server.address) || [];
    const name = names.get(server.address);
    if (name && name !== server.address) server.name = name;
  }
  // 5) mDNS 正向发现补充：_smb._tcp.local 的权威名称，覆盖 445 未开或 net view 漏掉的设备
  for (const server of await mdnsPromise) {
    const key = server.address.toLocaleLowerCase();
    if (seen.has(key)) {
      const existing = found.find((item) => item.address === server.address);
      if (existing && existing.name === existing.address && server.name) existing.name = server.name;
      continue;
    }
    seen.add(key);
    found.push({ address: server.address, name: server.name || server.address, shares: await netViewShares(server.address).catch(() => []) });
  }
  return found;
}

function smbErrorMessage(error, fallback = "SMB 操作失败") {
  if (typeof error === "string" && error && error !== "[object Object]") return error;
  if (error instanceof Error && error.message && error.message !== "[object Object]") return error.message;
  if (error && typeof error === "object") {
    for (const key of ["message", "description", "code", "status", "ntStatus"]) {
      const value = error[key];
      if (typeof value === "string" && value.trim() && value !== "[object Object]") return value;
      if (typeof value === "number") return `${key}: 0x${value.toString(16)}`;
    }
    try { const serialized = JSON.stringify(error); if (serialized !== "{}") return serialized; } catch {}
  }
  return fallback;
}

async function safeSmbOperation(action, fallback) {
  try { return await action(); }
  catch (error) { throw new Error(smbErrorMessage(error, fallback)); }
}

// ---- Windows 原生 SMB 文件操作（替代 node-smb2） ----
// node-smb2 仅实现 SMB2 早期子集，对现代 Windows/NAS 协商经常失败；
// 这里改用 Windows 内置 SMB 客户端：net use 建立会话 + Get-ChildItem / [IO.File] 操作，
// 兼容 SMB2/3 与任意凭据。net use 是全局会话，因此所有操作通过串行队列执行。

const SMB_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
let smbQueue = Promise.resolve();
const establishedSmbUncs = new Set();

function enqueueSmb(task) {
  const run = smbQueue.then(task, task);
  smbQueue = run.catch(() => undefined);
  return run;
}

function runPowerShell(script, timeoutMs = 20000, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, ...extraEnv } });
    const chunks = [];
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("SMB 操作超时"), null); }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", (error) => finish(error, null));
    child.once("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (code !== 0) finish(new Error(sanitizeSmbError(output, script) || `PowerShell 退出码 ${code}`), null);
      else finish(null, output);
    });
  });
}

// 脚本统一用 UTF-8 输出错误并经 try/catch 报告，避免 PowerShell 5.1 的 GBK 乱码；
// 异常按 HResult 低 16 位（Win32 错误码）映射为中文，避免透传英文系统消息。
function psWrap(body) {
  return [
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new()",
    "$ErrorActionPreference='Stop'",
    "try {",
    body,
    "} catch {",
    "  $hr = 0",
    "  if ($_.Exception.HResult) { $hr = $_.Exception.HResult -band 0xFFFF }",
    "  elseif ($_.Exception.InnerException -and $_.Exception.InnerException.HResult) { $hr = $_.Exception.InnerException.HResult -band 0xFFFF }",
    "  $map = @{ 2='系统找不到指定的文件或路径'; 53='找不到网络路径（主机不可达或名称无法解析）'; 64='指定的网络名不再可用'; 67='网络名或共享名不存在，请检查服务器与共享名'; 5='拒绝访问，请检查账号权限'; 1326='用户名或密码错误'; 1219='已有其他连接占用该共享，请断开重试' }",
    "  $why = if ($map.ContainsKey($hr)) { $map[$hr] + '（错误码 ' + $hr + '）' } else { $_.Exception.Message }",
    "  Write-Output ('SMB 操作失败：' + $why)",
    "  exit 1",
    "}",
  ].join("\n");
}

// 错误信息可能回显脚本行（含 Base64 凭据/路径），脱敏后只保留末尾可读片段。
function sanitizeSmbError(output, script) {
  let safe = String(output || "");
  const embedded = [...script.matchAll(/'([A-Za-z0-9+/=]{8,})'/g)].map((match) => match[1]);
  for (const value of embedded) safe = safe.split(value).join("***");
  return safe.slice(-400);
}

function smbPathValidation(connection, relativePath) {
  if (!/^[A-Za-z0-9._:-]+$/.test(connection.server || "") || !connection.share || /[\\/]/.test(connection.share)) throw new Error("SMB 服务器或共享名无效");
  const clean = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (clean.split("/").includes("..")) throw new Error("SMB 路径无效");
  return clean;
}

function smbUnc(connection, relativePath) {
  const clean = smbPathValidation(connection, relativePath);
  return `\\\\${connection.server}\\${connection.share}` + (clean ? `\\${clean.replaceAll("/", "\\")}` : "");
}

function smbB64(text) { return Buffer.from(String(text), "utf8").toString("base64"); }

async function netUseSession(unc, connection) {
  // net use 建立凭据会话；密码通过子进程环境变量传入（不进入任何进程的命令行）。
  // net use 的原生 stderr（系统 OEM 编码）用 2>$null 丢弃，仅依据退出码生成清晰中文错误。
  const body = [
    `$unc = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(unc)}'))`,
    `$dom = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(connection.domain || "")}'))`,
    `$usr = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(connection.username || "")}'))`,
    "$ErrorActionPreference='Continue'",
    "if ($dom -ne '' -or $usr -ne '') {",
    "  $who = if ($dom -ne '') { \"$dom`\\$usr\" } else { $usr }",
    "  net use \"$unc\" /user:\"$who\" $env:SMB_PWD 2>$null | Out-Null",
    "  $code = $LASTEXITCODE",
    "  if ($code -ne 0) { net use \"$unc\" /delete 2>$null | Out-Null; net use \"$unc\" /user:\"$who\" $env:SMB_PWD 2>$null | Out-Null; $code = $LASTEXITCODE }",
    "} else { net use \"$unc\" 2>$null | Out-Null; $code = $LASTEXITCODE }",
    "$ErrorActionPreference='Stop'",
    "if ($code -ne 0) {",
    "  $map = @{ 2='系统找不到指定的文件或路径'; 53='找不到网络路径（主机不可达或名称无法解析）'; 64='网络名不存在'; 67='网络名或共享名不存在，请检查服务器与共享名'; 5='拒绝访问'; 1326='用户名或密码错误'; 1219='已有其他连接占用该共享，请断开重试'; 85='本地设备名已被占用'; 86='指定的网络密码错误' }",
    "  $why = if ($map.ContainsKey($code)) { $map[$code] } else { ('错误码 ' + $code) }",
    "  throw ('无法连接：' + $why)",
    "}",
  ].join("\n");
  await runPowerShell(psWrap(body), 15000, { SMB_PWD: connection.password || "" });
}

async function ensureSmbSession(connection) {
  const unc = smbUnc(connection, "");
  await netUseSession(unc, connection);
  establishedSmbUncs.add(unc);
}

async function ensureServerSession(connection) {
  // 连接 IPC$ 建立服务器级凭据会话，用于枚举该服务器上的所有共享。
  if (!/^[A-Za-z0-9._:-]+$/.test(connection.server || "")) throw new Error("SMB 服务器地址无效");
  const unc = `\\\\${connection.server}\\IPC$`;
  await netUseSession(unc, connection);
  establishedSmbUncs.add(unc);
}

async function listServerShares(connection) {
  return enqueueSmb(async () => {
    await ensureServerSession(connection);
    // Get-ChildItem \\server 依赖 SMB1/浏览器服务的根枚举，现代系统普遍不可用；
    // 改用 NetShareEnum（netapi32）走已建立的 IPC$ 会话枚举共享，返回 Unicode 名称，并过滤 $ 结尾的隐藏共享。
    const body = [
      `$srv = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(connection.server)}'))`,
      'Add-Type -TypeDefinition @"',
      "using System;",
      "using System.Runtime.InteropServices;",
      "public static class PydShareEnum {",
      "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]",
      "  struct SI1 { public string NetName; public uint Type; public string Remark; }",
      "  [DllImport(\"netapi32.dll\", CharSet=CharSet.Unicode)] static extern int NetShareEnum(string server, int level, out IntPtr buf, int pref, out int read, out int total, ref int resume);",
      "  [DllImport(\"netapi32.dll\")] static extern int NetApiBufferFree(IntPtr p);",
      "  public static string[] List(string server) {",
      "    IntPtr buf; int read, total, resume = 0;",
      "    int rc = NetShareEnum(server, 1, out buf, -1, out read, out total, ref resume);",
      "    if (rc != 0) throw new System.ComponentModel.Win32Exception(rc);",
      "    var names = new System.Collections.Generic.List<string>();",
      "    IntPtr p = buf;",
      "    int sz = Marshal.SizeOf(typeof(SI1));",
      "    for (int i = 0; i < read; i++) {",
      "      var si = (SI1)Marshal.PtrToStructure(p, typeof(SI1));",
      "      if (!si.NetName.EndsWith(\"$\")) names.Add(si.NetName);",
      "      p = (IntPtr)(p.ToInt64() + sz);",
      "    }",
      "    NetApiBufferFree(buf);",
      "    return names.ToArray();",
      "  }",
      "}",
      '"@',
      "[PydShareEnum]::List($srv)",
    ].join("\n");
    const output = await runPowerShell(psWrap(body));
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  });
}

async function listDesktopSmb(connection, relativePath = "") {
  return enqueueSmb(async () => {
    await ensureSmbSession(connection);
    const clean = smbPathValidation(connection, relativePath);
    const body = [
      `$unc = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(smbUnc(connection, clean))}'))`,
      "$rows = Get-ChildItem -LiteralPath $unc -Force -ErrorAction Stop | ForEach-Object {",
      "  [pscustomobject]@{ name = $_.Name; directory = $_.PSIsContainer; size = if ($_.PSIsContainer) { 0 } else { $_.Length }; modifiedAt = if ($_.LastWriteTimeUtc) { $_.LastWriteTimeUtc.ToString('o') } else { $null } }",
      "}",
      "$rows | ConvertTo-Json -Compress -Depth 2",
    ].join("\n");
    const output = await runPowerShell(psWrap(body));
    const parsed = JSON.parse(output || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
    return rows
      .filter((row) => row.directory || SMB_FILE_PATTERN.test(String(row.name || "")))
      .map((row) => ({ name: String(row.name), path: clean ? `${clean}/${row.name}` : String(row.name), directory: Boolean(row.directory), size: Number(row.size || 0), modifiedAt: row.modifiedAt ?? null }));
  });
}

async function readDesktopSmb(connection, paths) {
  return enqueueSmb(async () => {
    await ensureSmbSession(connection);
    const results = [];
    let totalBytes = 0;
    for (const relativePath of paths.slice(0, 100)) {
      const clean = String(relativePath).replaceAll("\\", "/").replace(/^\/+/, "");
      if (clean.split("/").includes("..") || !SMB_FILE_PATTERN.test(clean)) throw new Error(`不支持的 SMB 文件：${clean}`);
      const body = [
        `$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${smbB64(smbUnc(connection, clean))}'))`,
        "if ((Get-Item -LiteralPath $p -Force).Length -gt 67108864) { throw '文件超过 64 MiB 限制' }",
        "[Convert]::ToBase64String([IO.File]::ReadAllBytes($p))",
      ].join("\n");
      const base64 = (await runPowerShell(psWrap(body))).trim();
      totalBytes += Math.floor((base64.length * 3) / 4);
      if (totalBytes > SMB_MAX_TOTAL_BYTES) throw new Error("SMB 导入总量超过 128 MiB 限制");
      results.push({ name: clean, base64 });
    }
    return results;
  });
}

function netViewShares(server) {
  // server 会拼入 PowerShell 命令，必须先校验，避免注入。
  if (!/^[A-Za-z0-9._:-]+$/.test(String(server || ""))) return Promise.resolve([]);
  // 用 Get-ChildItem 列共享（cmdlet 输出 Unicode，中文共享名不乱码；net view 依赖浏览器服务且是 GBK 输出）
  const script = [
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new()",
    `$srv = '${server}'`,
    "Get-ChildItem -LiteralPath (\"\\\\\" + $srv) -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }",
  ].join("\n");
  return runPowerShell(script, 8000).then((output) => {
    const shares = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return [...new Set(shares)];
  }).catch(() => []);
}

async function scanDesktopSmbShares(connection) {
  // 用凭据建立 IPC$ 会话后枚举服务器上的所有共享（Windows 原生流程）
  const shares = await listServerShares(connection);
  if (!shares.length) throw new Error("未能列出共享：请检查服务器地址与账号密码，或该服务器不允许枚举共享");
  return shares;
}

function smbSecretPath() { return path.join(app.getPath("userData"), "settings", "smb-secret.bin"); }
function saveDesktopSmbSecret(value) {
  const target = smbSecretPath(); fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!value) { if (fs.existsSync(target)) fs.rmSync(target); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 安全存储当前不可用");
  fs.writeFileSync(target, safeStorage.encryptString(String(value)));
}
function loadDesktopSmbSecret() {
  const target = smbSecretPath();
  if (!fs.existsSync(target) || !safeStorage.isEncryptionAvailable()) return "";
  return safeStorage.decryptString(fs.readFileSync(target));
}

function lanAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) for (const entry of interfaces ?? []) {
    if (entry.family === "IPv4" && !entry.internal) return entry.address;
  }
  return "127.0.0.1";
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on("data", (chunk) => { size += chunk.length; if (size > MAX_OUTPUT_BYTES) { reject(new Error("请求超过 64 MiB")); request.destroy(); } else chunks.push(chunk); });
    request.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (error) { reject(error); } });
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

function startDesktopRemoteServer(requirePin) {
  if (remoteServer) return Promise.resolve(remoteServer.__info);
  remotePin = requirePin ? String(crypto.randomInt(0, 10000)).padStart(4, "0") : null;
  remoteTokens.clear();
  const rendererRoot = app.isPackaged ? path.dirname(projectPaths().renderer) : path.resolve(__dirname, "..", "dist-desktop");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/health") return sendJson(response, 200, { requiresPin: Boolean(remotePin) });
      if (url.pathname === "/api/pair" && request.method === "POST") {
        const body = await readRequestBody(request);
        if (remotePin && String(body.pin ?? "") !== remotePin) return sendJson(response, 403, { error: "四位校验码不正确" });
        const token = crypto.randomBytes(24).toString("hex"); remoteTokens.add(token); return sendJson(response, 200, { token });
      }
      if (url.pathname.startsWith("/api/")) {
        if (!remoteTokens.has(String(request.headers["x-pydroid-token"] ?? ""))) return sendJson(response, 401, { error: "尚未配对" });
        const body = request.method === "POST" ? await readRequestBody(request) : {};
        if (url.pathname === "/api/execute") {
          const raw = await runPythonRequest({ workflow: String(body.workflow ?? ""), csvText: String(body.csvText ?? ""), inputFiles: JSON.stringify(body.inputFiles ?? []) });
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); return response.end(raw);
        }
        if (url.pathname === "/api/environment") return response.end(await runPythonRequest({ action: "environment" }));
        if (url.pathname === "/api/analyze-notebook") return response.end(await runPythonRequest({ action: "analyze_notebook", notebook: String(body.notebook ?? "") }));
        if (url.pathname === "/api/analyze-signature") return response.end(await runPythonRequest({ action: "analyze_signature", code: String(body.code ?? "") }));
        if (url.pathname === "/api/runtime-stats") {
          const memoryBytes = app.getAppMetrics().reduce((total, metric) => total + Math.max(0, metric.memory.workingSetSize) * 1024, 0);
          return sendJson(response, 200, { memoryBytes });
        }
        if (url.pathname === "/api/app-configuration") {
          let settings = {};
          try {
            const hostWindow = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
            const raw = hostWindow ? await hostWindow.webContents.executeJavaScript(`localStorage.getItem("pydroid-flow.settings.v1")`) : null;
            if (raw) settings = JSON.parse(raw);
          } catch {}
          return sendJson(response, 200, { settings, agentApiKey: "" });
        }
        return sendJson(response, 404, { error: "接口不存在" });
      }
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = path.resolve(rendererRoot, requested);
      if (!filePath.startsWith(path.resolve(rendererRoot)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); return response.end("Not found"); }
      const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(filePath)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); fs.createReadStream(filePath).pipe(response);
    } catch (error) { sendJson(response, 500, { error: error.message || String(error) }); }
  });
  return new Promise((resolve, reject) => server.once("error", reject).listen(0, "0.0.0.0", () => {
    const port = server.address().port; const info = { url: `http://${lanAddress()}:${port}/?remote=1`, pin: remotePin, requiresPin: Boolean(remotePin), port };
    server.__info = info; remoteServer = server; resolve(info);
  }));
}

function stopDesktopRemoteServer() {
  if (!remoteServer) return Promise.resolve();
  const server = remoteServer; remoteServer = null; remoteTokens.clear(); remotePin = null;
  return new Promise((resolve) => server.close(resolve));
}

// React Flow does not require GPU rendering. Disabling Chromium GPU composition
// avoids a known class of solid-colour/blank Electron windows on some Windows
// drivers, remote desktops and virtual machines.
app.disableHardwareAcceleration();

function appendDesktopLog(message) {
  try {
    const directory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "desktop.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch { /* Diagnostics must never prevent the window from opening. */ }
}

function projectPaths() {
  if (app.isPackaged) {
    return {
      renderer: path.join(app.getAppPath(), "desktop", "package-renderer", "index.html"),
      python: path.join(process.resourcesPath, "python"),
    };
  }
  const root = path.resolve(__dirname, "..");
  return {
    renderer: path.join(root, "dist-desktop", "index.html"),
    python: path.join(root, "python"),
  };
}

function ensureUserProfile() {
  const root = app.getPath("userData");
  for (const name of ["settings", "user-code", "workflows", "logs"]) fs.mkdirSync(path.join(root, name), { recursive: true });
}

function pythonCommand(scriptPath, pythonRoot) {
  const configured = process.env.PYDROID_PYTHON_EXECUTABLE?.trim();
  if (configured) return { executable: configured, args: [scriptPath] };
  if (process.platform === "win32") {
    const projectPython = app.isPackaged
      ? path.join(process.resourcesPath, "python-runtime", "python.exe")
      : path.join(path.dirname(pythonRoot), ".tools", "python312-runtime", "python.exe");
    if (require("node:fs").existsSync(projectPython)) {
      return { executable: projectPython, args: [scriptPath] };
    }
    return { executable: "py", args: ["-3.12", scriptPath] };
  }
  return { executable: "python3.12", args: [scriptPath] };
}

function runPythonRequest(payload) {
  const isUtilityRequest = payload?.action === "environment" || payload?.action === "analyze_notebook";
  if (!isUtilityRequest && (!payload || typeof payload.workflow !== "string" || typeof payload.csvText !== "string" || typeof payload.inputFiles !== "string")) {
    return Promise.reject(new Error("workflow, csvText, and inputFiles are required"));
  }

  const { python } = projectPaths();
  const script = path.join(python, "pydroid_flow", "desktop_bridge.py");
  const command = pythonCommand(script, python);
  const pythonPath = [python, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: python,
      env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("Python execution output exceeded 64 MiB"));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => reject(new Error(`Unable to start Python 3.12: ${error.message}`)));
    child.on("close", (code) => {
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(errorText || `Python execution exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    // Use an ASCII-only frame on stdin. Workflow parameters may contain quotes,
    // newlines, non-BMP text and user-provided JSON; transporting their UTF-8
    // representation as Base64 prevents shell/runtime encoding from ever
    // turning a valid renderer payload into malformed JSON before Python sees it.
    const requestFrame = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    child.stdin.end(`PYDROID_FLOW_BASE64_V1\n${requestFrame}`, "ascii");
  });
}

function createWindow() {
  const smokeTest = process.env.PYDROID_DESKTOP_SMOKE === "1";
  const sharedAppIcon = path.resolve(__dirname, "..", "android", "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher_round.png");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0b1020",
    frame: false,
    ...(fs.existsSync(sharedAppIcon) ? { icon: sharedAppIcon } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => appendDesktopLog(`did-fail-load ${code} ${description} ${url}`));
  window.on("maximize", () => window.webContents.send("pydroid:window-maximized-changed", true));
  window.on("unmaximize", () => window.webContents.send("pydroid:window-maximized-changed", false));
  window.webContents.on("render-process-gone", (_event, details) => appendDesktopLog(`render-process-gone ${details.reason} ${details.exitCode}`));
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) appendDesktopLog(`renderer-console level=${level} ${message} ${sourceId}:${line}`);
  });
  if (!smokeTest) {
    window.once("ready-to-show", () => window.show());
    setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show(); }, 5000);
  }
  const developmentUrl = process.env.PYDROID_DESKTOP_URL;
  if (developmentUrl) window.loadURL(developmentUrl);
  else window.loadFile(projectPaths().renderer);

  if (smokeTest) {
    window.webContents.once("did-finish-load", async () => {
      const payload = {
        workflow: JSON.stringify({
          schemaVersion: 1,
          name: "desktop multi-file smoke test",
          nodes: [
            {
              id: "read-batch",
              data: {
                nodeType: "io.read_csv_batch",
                parameters: {
                  header: "infer",
                  skipRows: 0,
                  sourceColumn: "source_file",
                  metadataColumn: "",
                  filenamePattern: "",
                  onError: "error",
                },
              },
            },
            { id: "export-a", data: { nodeType: "io.export_csv", parameters: { fileName: "desktop-a.csv" } } },
            { id: "export-b", data: { nodeType: "io.export_csv", parameters: { fileName: "desktop-b.csv" } } },
          ],
          edges: [
            { id: "e1", source: "read-batch", target: "export-a" },
            { id: "e2", source: "read-batch", target: "export-b" },
          ],
        }),
        csvText: "",
        inputFiles: JSON.stringify([
          { name: "first.csv", text: "a,b\n1,2\n" },
          { name: "second.csv", text: "a,b\n3,4\n" },
        ]),
      };
      try {
        const rendererState = await window.webContents.executeJavaScript(`({
          shell: Boolean(document.querySelector('.app-shell')),
          topbar: Boolean(document.querySelector('.topbar')),
          canvas: Boolean(document.querySelector('.canvas-panel')),
          text: document.body.innerText.slice(0, 200)
        })`);
        if (!rendererState.shell || !rendererState.topbar || !rendererState.canvas) {
          throw new Error(`Desktop renderer did not mount its UI: ${JSON.stringify(rendererState)}`);
        }
        const rawEnvironment = await window.webContents.executeJavaScript(
          "window.pyDroidDesktop.getEnvironment()",
        );
        const environment = JSON.parse(rawEnvironment);
        if (!environment.pythonVersion || !environment.packages.some((item) => item.name.toLowerCase() === "pandas")) {
          throw new Error(`Unexpected desktop environment result: ${rawEnvironment}`);
        }
        const runtimeStats = await window.webContents.executeJavaScript("window.pyDroidDesktop.getRuntimeStats()");
        if (!runtimeStats || !Number.isFinite(runtimeStats.memoryBytes) || runtimeStats.memoryBytes <= 0) {
          throw new Error(`Unexpected desktop runtime stats: ${JSON.stringify(runtimeStats)}`);
        }
        const notebook = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["print('ok')\n"] }] });
        const rawAnalysis = await window.webContents.executeJavaScript(`window.pyDroidDesktop.analyzeNotebook(${JSON.stringify(notebook)})`);
        const analysis = JSON.parse(rawAnalysis);
        if (!Array.isArray(analysis.cells) || analysis.cells.length !== 1) {
          throw new Error(`Unexpected notebook analysis result: ${rawAnalysis}`);
        }

        const raw = await window.webContents.executeJavaScript(
          `window.pyDroidDesktop.runWorkflow(${JSON.stringify(payload)})`,
        );
        const result = JSON.parse(raw);
        const exportNames = new Set((result.exports ?? []).map((item) => item.fileName));
        if (
          result.status !== "success"
          || result.preview.totalRows !== 2
          || result.preview.totalColumns !== 3
          || !result.nodeResults?.["read-batch"]
          || exportNames.size !== 2
          || !exportNames.has("desktop-a.csv")
          || !exportNames.has("desktop-b.csv")
        ) {
          throw new Error(`Unexpected smoke-test result: ${raw}`);
        }
        console.log("Desktop Electron/IPC/Python multi-file smoke test passed");
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) {
          require("node:fs").writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, "passed\n", "utf8");
        }
        app.exit(0);
      } catch (error) {
        console.error(error);
        if (process.env.PYDROID_DESKTOP_SMOKE_LOG) {
          require("node:fs").writeFileSync(process.env.PYDROID_DESKTOP_SMOKE_LOG, `${error.stack || error}\n`, "utf8");
        }
        app.exit(1);
      }
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureUserProfile();
  ipcMain.on("pydroid:window-minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("pydroid:window-toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on("pydroid:window-close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("pydroid:window-is-maximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
  ipcMain.handle("pydroid:run-workflow", (_event, payload) => runPythonRequest(payload));
  ipcMain.handle("pydroid:get-environment", () => runPythonRequest({ action: "environment" }));
  ipcMain.handle("pydroid:analyze-notebook", (_event, notebook) => runPythonRequest({ action: "analyze_notebook", notebook }));
  ipcMain.handle("pydroid:analyze-signature", (_event, code) => runPythonRequest({ action: "analyze_signature", code }));
  ipcMain.handle("pydroid:get-runtime-stats", async () => {
    const metrics = app.getAppMetrics();
    const memoryBytes = metrics.reduce((total, metric) => total + Math.max(0, metric.memory.workingSetSize) * 1024, 0);
    return { memoryBytes };
  });
  ipcMain.handle("pydroid:start-remote-server", (_event, requirePin) => startDesktopRemoteServer(Boolean(requirePin)));
  ipcMain.handle("pydroid:stop-remote-server", () => stopDesktopRemoteServer());
  ipcMain.handle("pydroid:discover-smb-servers", () => safeSmbOperation(() => discoverSmbServers(), "无法扫描局域网 SMB 设备"));
  ipcMain.handle("pydroid:scan-smb-shares", (_event, connection) => safeSmbOperation(() => scanDesktopSmbShares(connection), "无法扫描 SMB 共享"));
  ipcMain.handle("pydroid:list-smb", (_event, connection, relativePath) => safeSmbOperation(() => listDesktopSmb(connection, relativePath), "无法访问 SMB 文件夹"));
  ipcMain.handle("pydroid:read-smb", (_event, connection, paths) => safeSmbOperation(() => readDesktopSmb(connection, paths), "无法读取 SMB 文件"));
  ipcMain.handle("pydroid:save-smb-secret", (_event, value) => { saveDesktopSmbSecret(value); return { saved: true }; });
  ipcMain.handle("pydroid:load-smb-secret", () => ({ value: loadDesktopSmbSecret() }));
  ipcMain.handle("pydroid:pick-csv", async (_event, mode) => {
    const directory = String(mode).startsWith("directory");
    const properties = directory ? ["openDirectory"] : ["openFile", "multiSelections"];
    const result = await dialog.showOpenDialog({ title: directory ? "选择包含数据文件的文件夹" : "选择数据文件", properties, filters: [{ name: "数据文件", extensions: ["csv", "tsv", "txt", "dat", "json", "png", "jpg", "jpeg"] }, { name: "所有文件", extensions: ["*"] }] });
    if (result.canceled) return [];
    const paths = directory
      ? fs.readdirSync(result.filePaths[0], { withFileTypes: true }).filter((item) => item.isFile() && /\.(csv|tsv|txt|dat|json|png|jpe?g)$/i.test(item.name)).map((item) => path.join(result.filePaths[0], item.name))
      : result.filePaths;
    return paths.map((filePath) => ({ name: path.basename(filePath), base64: fs.readFileSync(filePath).toString("base64") }));
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void stopDesktopRemoteServer();
  if (process.platform !== "darwin") app.quit();
});

// 退出时清理 SMB net use 会话，避免凭据驻留在系统会话中。
app.on("before-quit", () => {
  if (establishedSmbUncs.size === 0) return;
  for (const unc of establishedSmbUncs) {
    try { spawnSync("net", ["use", unc, "/delete", "/y"], { windowsHide: true }); } catch { /* 忽略清理失败 */ }
  }
  establishedSmbUncs.clear();
});
