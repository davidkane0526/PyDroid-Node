const dgram = require("node:dgram");
const { selectInterfaceForRemote } = require("./network.cjs");

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const ROOT = "upnp:rootdevice";
const BASIC = "urn:schemas-upnp-org:device:Basic:1";

class SsdpService {
  constructor(log = () => {}) {
    this.log = log;
    this.socket = null;
    this.timer = null;
    this.interfaces = [];
    this.config = null;
    this.pending = new Set();
  }

  start(config, interfaces) {
    this.stop(false);
    this.config = config;
    this.interfaces = interfaces;
    if (!interfaces.length) throw new Error("没有可用于 SSDP 的局域网 IPv4 接口");
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("error", (error) => this.log(`[SSDP] ${error.message}`));
    socket.on("message", (message, remote) => this.handleMessage(message, remote));
    socket.bind(SSDP_PORT, "0.0.0.0", () => {
      if (this.socket !== socket) { try { socket.close(); } catch {} return; }
      try { socket.setMulticastTTL(2); } catch {}
      for (const item of interfaces) {
        try {
          socket.addMembership(SSDP_ADDRESS, item.address);
          this.log(`[SSDP] Joined ${SSDP_ADDRESS}:${SSDP_PORT} via ${item.name} / ${item.address}`);
        } catch (error) { this.log(`[SSDP] Join failed on ${item.address}: ${error.message}`); }
      }
      this.announce("ssdp:alive");
      this.timer = setInterval(() => this.announce("ssdp:alive"), 300_000);
      this.timer.unref?.();
    });
  }

  location(item) { return `http://${item.address}:${this.config.port}/upnp/device.xml`; }

  types() {
    const uuidTarget = `uuid:${this.config.uuid}`;
    return [
      { target: ROOT, usn: `${uuidTarget}::${ROOT}` },
      { target: uuidTarget, usn: uuidTarget },
      { target: BASIC, usn: `${uuidTarget}::${BASIC}` },
    ];
  }

  notifyPayload(item, type, nts) {
    const alive = nts === "ssdp:alive";
    const lines = [
      "NOTIFY * HTTP/1.1",
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      ...(alive ? ["CACHE-CONTROL: max-age=1800", `LOCATION: ${this.location(item)}`] : []),
      `NT: ${type.target}`,
      `NTS: ${nts}`,
      "SERVER: UPnP/1.0 PyDroid-Node/1.0",
      `USN: ${type.usn}`,
      "BOOTID.UPNP.ORG: 1",
      "CONFIGID.UPNP.ORG: 1",
      "",
      "",
    ];
    return Buffer.from(lines.join("\r\n"), "utf8");
  }

  announce(nts) {
    const socket = this.socket;
    if (!socket) return;
    for (const item of this.interfaces) {
      for (const type of this.types()) {
        try { socket.setMulticastInterface(item.address); } catch {}
        socket.send(this.notifyPayload(item, type, nts), SSDP_PORT, SSDP_ADDRESS, (error) => {
          if (error) this.log(`[SSDP] NOTIFY ${nts} failed on ${item.address}: ${error.message}`);
        });
      }
    }
    this.log(`[SSDP] NOTIFY ${nts}`);
  }

  handleMessage(message, remote) {
    const text = message.toString("utf8");
    if (!/^M-SEARCH \* HTTP\/1\.1/im.test(text)) return;
    const headers = {};
    for (const line of text.split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const st = String(headers.st || "").toLowerCase();
    const supported = this.types();
    const matching = st === "ssdp:all" ? supported : supported.filter((item) => item.target.toLowerCase() === st);
    if (!matching.length) return;
    const item = selectInterfaceForRemote(this.interfaces, remote.address);
    if (!item) return;
    this.log(`[SSDP] M-SEARCH from ${remote.address}:${remote.port} ST=${headers.st || ""}`);
    matching.forEach((type, index) => {
      const delay = 10 + Math.floor(Math.random() * 71) + index * 8;
      const timer = setTimeout(() => {
        this.pending.delete(timer);
        if (!this.socket) return;
        const body = Buffer.from([
          "HTTP/1.1 200 OK",
          "CACHE-CONTROL: max-age=1800",
          "EXT:",
          `LOCATION: ${this.location(item)}`,
          "SERVER: UPnP/1.0 PyDroid-Node/1.0",
          `ST: ${type.target}`,
          `USN: ${type.usn}`,
          "BOOTID.UPNP.ORG: 1",
          "CONFIGID.UPNP.ORG: 1",
          "",
          "",
        ].join("\r\n"), "utf8");
        this.socket.send(body, remote.port, remote.address, (error) => {
          if (error) this.log(`[SSDP] Response failed: ${error.message}`);
          else this.log(`[SSDP] Response sent to ${remote.address} ST=${type.target}`);
        });
      }, delay);
      timer.unref?.();
      this.pending.add(timer);
    });
  }

  stop(sendByebye = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
    if (this.socket && sendByebye && this.config) {
      try { this.announce("ssdp:byebye"); } catch {}
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      for (const item of this.interfaces) {
        try { socket.dropMembership(SSDP_ADDRESS, item.address); } catch {}
      }
      setTimeout(() => { try { socket.close(); } catch {} }, sendByebye ? 60 : 0).unref?.();
    }
  }
}

module.exports = { SsdpService, SSDP_ADDRESS, SSDP_PORT };
