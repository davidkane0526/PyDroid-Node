import manifestScalePackage from "../examples/plugins/demo-manifest-scale.plugin.json?raw";
import manifestTablePackage from "../examples/plugins/demo-manifest-table-tools.plugin.json?raw";
import { activateNodePluginPackage, listActiveNodePluginPackages } from "./nodePluginPackages";

function activateOnce(manifestText: string, id: string): void {
  if (listActiveNodePluginPackages().some((item) => item.id === id)) return;
  activateNodePluginPackage(manifestText);
}

export function activateManifestScalePackageDemo(): void {
  activateOnce(manifestScalePackage, "demo.manifest-scale");
}

export function activateManifestTablePackageDemo(): void {
  activateOnce(manifestTablePackage, "demo.manifest-table-tools");
}
