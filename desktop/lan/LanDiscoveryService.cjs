const { getLanInterfaces, networkKey } = require("./network.cjs");
const { loadOrCreateIdentity } = require("./identity.cjs");
const { makeUpnpDeviceXml } = require("./upnp.cjs");
const { SsdpService } = require("./ssdp.cjs");
const { MdnsService } = require("./mdns.cjs");

class LanDiscoveryService {
  constructor({ userDataRoot, log = () => {}, version = "" }) {
    this.log = log;
    this.identity = loadOrCreateIdentity(userDataRoot);
    this.version = String(version || "");
    this.ssdp = null;
    this.mdns = null;
    this.interfaces = [];
    this.key = "";
    this.port = 0;
    this.monitor = null;
    this.running = false;
    this.status = { ssdp: "stopped", mdns: "stopped" };
  }

  config() { return { ...this.identity, port: this.port, version: this.version }; }

  start({ port }) {
    this.stop();
    this.port = port;
    this.running = true;
    this.restartDiscovery();
    this.monitor = setInterval(() => {
      const next = getLanInterfaces();
      const nextKey = networkKey(next);
      if (nextKey !== this.key) {
        this.log(`[LAN] Network changed: ${this.key || "none"} -> ${nextKey}`);
        this.restartDiscovery(next);
      }
    }, 5_000);
    this.monitor.unref?.();
    return this.getStatus();
  }

  restartDiscovery(precomputed = null) {
    if (!this.running) return;
    this.ssdp?.stop();
    this.mdns?.stop();
    this.ssdp = null;
    this.mdns = null;
    this.interfaces = precomputed ?? getLanInterfaces();
    this.key = networkKey(this.interfaces);
    if (!this.interfaces.length) {
      this.status = { ssdp: "unavailable", mdns: "unavailable" };
      this.log("[LAN] No usable IPv4 LAN interface; HTTP remains available on 0.0.0.0");
      return;
    }
    for (const item of this.interfaces) this.log(`[LAN] Interface ${item.name} / ${item.address}`);
    const config = this.config();
    try { this.ssdp = new SsdpService(this.log); this.ssdp.start(config, this.interfaces); this.status.ssdp = "running"; }
    catch (error) { this.status.ssdp = `failed: ${error.message}`; this.log(`[SSDP] Startup failed: ${error.message}`); }
    try { this.mdns = new MdnsService(this.log); this.mdns.start(config, this.interfaces); this.status.mdns = "running"; }
    catch (error) { this.status.mdns = `failed: ${error.message}`; this.log(`[mDNS] Startup failed: ${error.message}`); }
  }

  primaryAddress() { return this.interfaces[0]?.address ?? "127.0.0.1"; }
  presentationUrl(ip = this.primaryAddress()) { return `http://${ip}:${this.port}/`; }
  localUrl() { return `http://${this.identity.hostname}.local:${this.port}/`; }
  deviceXml(ip = this.primaryAddress()) { return makeUpnpDeviceXml({ ...this.config(), ip }); }

  getStatus() {
    return {
      running: this.running,
      friendlyName: this.identity.friendlyName,
      hostname: this.identity.hostname,
      uuid: this.identity.uuid,
      identityPath: this.identity.filePath,
      interfaces: this.interfaces.map((item) => ({ name: item.name, address: item.address })),
      localUrl: this.running && this.port ? this.localUrl() : null,
      ...this.status,
    };
  }

  stop() {
    this.running = false;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    this.ssdp?.stop();
    this.mdns?.stop();
    this.ssdp = null;
    this.mdns = null;
    this.interfaces = [];
    this.key = "";
    this.status = { ssdp: "stopped", mdns: "stopped" };
  }
}

module.exports = { LanDiscoveryService };
