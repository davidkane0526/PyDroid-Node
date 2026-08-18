const dgram = require("node:dgram");

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const TYPE_ANY = 255;

function encodeName(name) {
  const labels = String(name).replace(/\.$/, "").split(".");
  const chunks = [];
  for (const labelText of labels) {
    const label = Buffer.from(labelText, "utf8");
    if (!label.length || label.length > 63) throw new Error(`无效 mDNS 标签: ${labelText}`);
    chunks.push(Buffer.from([label.length]), label);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function decodeName(message, offset) {
  const labels = [];
  let cursor = offset;
  let end = -1;
  let hops = 0;
  while (cursor < message.length && hops++ < 64) {
    const length = message[cursor];
    if (length === 0) { cursor++; if (end < 0) end = cursor; break; }
    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= message.length) break;
      const pointer = ((length & 0x3f) << 8) | message[cursor + 1];
      if (end < 0) end = cursor + 2;
      cursor = pointer;
      continue;
    }
    if (cursor + 1 + length > message.length) break;
    labels.push(message.subarray(cursor + 1, cursor + 1 + length).toString("utf8"));
    cursor += 1 + length;
  }
  return { name: labels.join(".").toLowerCase(), end: end < 0 ? cursor : end };
}

function record(name, type, ttl, data, flush = true) {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(flush ? 0x8001 : 1, 2);
  header.writeUInt32BE(ttl >>> 0, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), header, data]);
}

function ipv4Bytes(address) { return Buffer.from(address.split(".").map(Number)); }
function ptrData(target) { return encodeName(target); }
function srvData(hostname, port) {
  const fixed = Buffer.alloc(6);
  fixed.writeUInt16BE(0, 0); fixed.writeUInt16BE(0, 2); fixed.writeUInt16BE(port, 4);
  return Buffer.concat([fixed, encodeName(hostname)]);
}
function txtData(values) {
  const chunks = [];
  for (const value of values) {
    const bytes = Buffer.from(value, "utf8");
    chunks.push(Buffer.from([Math.min(bytes.length, 255)]), bytes.subarray(0, 255));
  }
  return Buffer.concat(chunks);
}

function responsePacket(records) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(records.length, 6);
  return Buffer.concat([header, ...records]);
}

function parseQuestions(message) {
  if (message.length < 12) return [];
  const count = message.readUInt16BE(4);
  let cursor = 12;
  const questions = [];
  for (let i = 0; i < count; i++) {
    const decoded = decodeName(message, cursor);
    cursor = decoded.end;
    if (cursor + 4 > message.length) break;
    questions.push({ name: decoded.name, type: message.readUInt16BE(cursor) });
    cursor += 4;
  }
  return questions;
}

class MdnsService {
  constructor(log = () => {}) {
    this.log = log;
    this.socket = null;
    this.interfaces = [];
    this.config = null;
  }

  start(config, interfaces) {
    this.stop(false);
    this.config = config;
    this.interfaces = interfaces;
    if (!interfaces.length) throw new Error("没有可用于 mDNS 的局域网 IPv4 接口");
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("error", (error) => this.log(`[mDNS] ${error.message}`));
    socket.on("message", (message) => this.handleMessage(message));
    socket.bind(MDNS_PORT, "0.0.0.0", () => {
      if (this.socket !== socket) { try { socket.close(); } catch {} return; }
      for (const item of interfaces) {
        try { socket.addMembership(MDNS_ADDRESS, item.address); } catch (error) { this.log(`[mDNS] Join failed on ${item.address}: ${error.message}`); }
      }
      this.announce(120);
      const second = setTimeout(() => this.announce(120), 750); second.unref?.();
      this.log(`[mDNS] ${this.config.hostname}.local published as _http._tcp.local`);
    });
  }

  names() {
    const host = `${this.config.hostname}.local`;
    const service = "_http._tcp.local";
    const instanceLabel = `PyDroid Node - ${this.config.hostname}`.replace(/\./g, "-").slice(0, 63);
    const instance = `${instanceLabel}.${service}`;
    return { host, service, instance };
  }

  recordsForInterface(item, ttl = 120) {
    const { host, service, instance } = this.names();
    return [
      record(host, TYPE_A, ttl, ipv4Bytes(item.address), true),
      record(service, TYPE_PTR, ttl, ptrData(instance), false),
      record(instance, TYPE_SRV, ttl, srvData(host, this.config.port), true),
      record(instance, TYPE_TXT, ttl, txtData(["path=/?remote=1", "product=PyDroid Node"]), true),
      record("_services._dns-sd._udp.local", TYPE_PTR, ttl, ptrData(service), false),
    ];
  }

  sendPacket(packet, item) {
    if (!this.socket) return;
    try { this.socket.setMulticastInterface(item.address); } catch {}
    this.socket.send(packet, MDNS_PORT, MDNS_ADDRESS, (error) => { if (error) this.log(`[mDNS] send failed on ${item.address}: ${error.message}`); });
  }

  announce(ttl) {
    for (const item of this.interfaces) this.sendPacket(responsePacket(this.recordsForInterface(item, ttl)), item);
  }

  handleMessage(message) {
    const questions = parseQuestions(message);
    if (!questions.length || !this.config) return;
    const { host, service, instance } = this.names();
    const interesting = questions.some((question) => {
      if (![TYPE_ANY, TYPE_A, TYPE_PTR, TYPE_SRV, TYPE_TXT].includes(question.type)) return false;
      return question.name === host.toLowerCase() || question.name === service.toLowerCase() || question.name === instance.toLowerCase() || question.name === "_services._dns-sd._udp.local";
    });
    if (!interesting) return;
    for (const item of this.interfaces) this.sendPacket(responsePacket(this.recordsForInterface(item, 120)), item);
  }

  stop(goodbye = true) {
    if (this.socket && goodbye && this.config) {
      try { this.announce(0); } catch {}
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      for (const item of this.interfaces) {
        try { socket.dropMembership(MDNS_ADDRESS, item.address); } catch {}
      }
      setTimeout(() => { try { socket.close(); } catch {} }, goodbye ? 60 : 0).unref?.();
    }
  }
}

module.exports = { MdnsService, encodeName, parseQuestions, responsePacket };
