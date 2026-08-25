import manifestScalePackage from "../examples/plugins/demo-manifest-scale.plugin.json?raw";
import manifestTablePackage from "../examples/plugins/demo-manifest-table-tools.plugin.json?raw";
import resourceScalePackage from "../examples/plugins/demo-resource-scale.plugin.json?raw";
import resourceTablePackage from "../examples/plugins/demo-resource-table.plugin.json?raw";
import declarativeScalePackage from "../examples/plugins/demo-declarative-scale.plugin.json?raw";
import declarativeTablePackage from "../examples/plugins/demo-declarative-table.plugin.json?raw";
import conditionalUiPackage from "../examples/plugins/demo-conditional-ui.plugin.json?raw";
import linkedEnumTablePackage from "../examples/plugins/demo-linked-enum-table.plugin.json?raw";
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

export function activateResourceScalePackageDemo(): void {
  activateOnce(resourceScalePackage, "demo.resource-scale");
}

export function activateResourceTablePackageDemo(): void {
  activateOnce(resourceTablePackage, "demo.resource-table");
}

export function activateDeclarativeScalePackageDemo(): void {
  activateOnce(declarativeScalePackage, "demo.declarative-scale");
}

export function activateDeclarativeTablePackageDemo(): void {
  activateOnce(declarativeTablePackage, "demo.declarative-table");
}

export function activateConditionalUiPackageDemo(): void {
  activateOnce(conditionalUiPackage, "demo.conditional-ui");
}

export function activateLinkedEnumTablePackageDemo(): void {
  activateOnce(linkedEnumTablePackage, "demo.linked-enum-table");
}
