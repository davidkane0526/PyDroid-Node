const { getLanInterfaces } = require("./network.cjs");
const { loadOrCreateIdentity } = require("./identity.cjs");
const { makeUpnpDeviceXml } = require("./upnp.cjs");
const { SsdpService } = require("./ssdp.cjs");
const { MdnsService } = require("./mdns.cjs");

class LanDiscoveryService {
  constructor({ userDataRoot, log = () => {}, version = "" }) {
    this.log = log;
    this.identity = loadOrCreateIdentity(userDataRoot);
    this.version = String(version || "");
    this.port = 0;
    this.interfaces = [];
    this.ssdp = null;
    this.mdns = null;
    this.status = { ssdp: "stopped", mdns: "stopped" };
  }

  config() { return { ...this.identity, port: this.port, version: this.version }; }

  start({ port }) {
    this.stop();
    this.port = port;
    this.interfaces = getLanInterfaces();
    if (!this.interfaces.length) {
      this.status = { ssdp: "unavailable", mdns: "unavailable" };
      this.log("[LAN] No usable IPv4 LAN interface; HTTP remains available on 0.0.0.0");
      return this.getStatus();
    }

    for (const item of this.interfaces) this.log(`[LAN] Interface ${item.name} / ${item.address}${item.defaultRoute ? " (default route)" : ""}`);
    const config = this.config();

    this.ssdp = new SsdpService(this.log);
    this.status.ssdp = "starting";
    this.ssdp.start(config, this.interfaces).then(() => { this.status.ssdp = "running"; }).catch((error) => {
      this.status.ssdp = `failed: ${error.message}`;
      this.log(`[SSDP] Startup failed: ${error.message}`);
    });

    this.mdns = new MdnsService(this.log);
    this.status.mdns = "starting";
    this.mdns.start(config, this.interfaces).then(() => { this.status.mdns = "running"; }).catch((error) => {
      this.status.mdns = `failed: ${error.message}`;
      this.log(`[mDNS] Startup failed: ${error.message}`);
    });

    return this.getStatus();
  }

  primaryAddress() { return this.interfaces.find((item) => item.defaultRoute)?.address ?? this.interfaces[0]?.address ?? "127.0.0.1"; }
  presentationUrl(ip = this.primaryAddress()) { return `http://${ip}:${this.port}/`; }
  localUrl() { return `http://${this.identity.hostname}.local:${this.port}/`; }
  deviceXml(ip = this.primaryAddress()) { return makeUpnpDeviceXml({ ...this.config(), ip }); }

  getStatus() {
    return {
      interfaces: this.interfaces.map((item) => ({ name: item.name, address: item.address, defaultRoute: Boolean(item.defaultRoute) })),
      ssdp: this.status.ssdp,
      mdns: this.status.mdns,
      localUrl: this.port ? this.localUrl() : null,
    };
  }

  stop() {
    this.ssdp?.stop();
    this.mdns?.stop();
    this.ssdp = null;
    this.mdns = null;
    this.interfaces = [];
    this.port = 0;
    this.status = { ssdp: "stopped", mdns: "stopped" };
  }
}

module.exports = { LanDiscoveryService };
