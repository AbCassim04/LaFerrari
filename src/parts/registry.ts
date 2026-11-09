import { bodyParts } from './body';
import { engineParts } from './engine';
import { intakeExhaustParts } from './engine/intakeExhaust';
import { chassisParts } from './chassis';
import { coolingParts } from './cooling';
import { drivetrainParts } from './drivetrain';
import { powertrainAssembly } from './powertrain';
import type { PartDef } from './types';

/**
 * Every part in the car: the single source of truth for geometry, placement,
 * explode choreography and the info panel. Parents must be listed before their children.
 */
export const PARTS: readonly PartDef[] = [
  ...bodyParts,
  powertrainAssembly,
  ...engineParts,
  ...intakeExhaustParts,
  ...drivetrainParts,
  ...coolingParts,
  ...chassisParts,
];

export const PARTS_BY_ID: ReadonlyMap<string, PartDef> = new Map(PARTS.map((p) => [p.id, p]));

export const CHILDREN: ReadonlyMap<string, readonly PartDef[]> = (() => {
  const map = new Map<string, PartDef[]>();
  for (const p of PARTS) {
    if (!p.parent) continue;
    const list = map.get(p.parent) ?? [];
    list.push(p);
    map.set(p.parent, list);
  }
  return map;
})();

export const ROOT_PARTS: readonly PartDef[] = PARTS.filter((p) => !p.parent);

function validate(parts: readonly PartDef[]) {
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.id)) throw new Error(`registry: duplicate part id "${p.id}"`);
    if (p.parent && !seen.has(p.parent)) {
      throw new Error(`registry: "${p.id}" has parent "${p.parent}", which must be listed before it`);
    }
    if (p.build && !p.material && p.source !== 'model') {
      throw new Error(`registry: procedural part "${p.id}" has a build but no material`);
    }
    seen.add(p.id);
  }
}

if (import.meta.env.DEV) validate(PARTS);
