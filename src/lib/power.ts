/**
 * Mains and battery (D59): what the kernel says about the machine's power
 * supplies, in /sys/class/power_supply, and what doctor says about it.
 *
 * Each supply is a directory with a `type`: `Mains` (and `USB`) with `online`,
 * 1 or 0; `Battery` with `status` (Charging, Discharging, Full, Not charging),
 * `capacity` in percent, and, where the machine reports them, either
 * `energy_now` and `power_now` (µWh, µW), or `charge_now` and `current_now`
 * (µAh, µA), or `time_to_empty_now` in seconds.
 *
 * A test host has no battery. Its test overrides (D14, honoured only in a
 * container) may point `power-supply-dir` at a stand-in for this directory,
 * so the tests can show every case; a real machine reads the kernel's.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const POWER_SUPPLY_DIR = "/sys/class/power_supply";
/** At or under this, on battery, doctor calls it a problem: the machine will stop soon. */
export const LOW_BATTERY_PERCENT = 20;

export interface Battery {
  name: string;
  status: string;
  capacity: number | null;
  /** Minutes left, when the machine reports enough to say, and it is discharging. */
  minutesLeft: number | null;
}

export interface Power {
  /** True or false when a mains supply reports whether it is online; null when none does. */
  mains: boolean | null;
  batteries: Battery[];
}

const read = (dir: string, file: string): string | null => {
  try {
    return readFileSync(path.join(dir, file), "utf8").trim();
  } catch {
    return null;
  }
};
const num = (dir: string, file: string): number | null => {
  const text = read(dir, file);
  const value = text === null ? NaN : Number(text);
  return Number.isFinite(value) ? value : null;
};

export function readPower(root = POWER_SUPPLY_DIR): Power {
  const power: Power = { mains: null, batteries: [] };
  if (!existsSync(root)) return power;
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name);
    const type = read(dir, "type");
    if (type === "Mains" || type === "USB") {
      const online = num(dir, "online");
      if (online !== null) power.mains = (power.mains ?? false) || online === 1;
    } else if (type === "Battery") {
      if (num(dir, "present") === 0) continue;
      const status = read(dir, "status") ?? "Unknown";
      const discharging = status === "Discharging";
      let minutesLeft: number | null = null;
      const toEmpty = num(dir, "time_to_empty_now");
      const energy = num(dir, "energy_now");
      const draw = num(dir, "power_now");
      const charge = num(dir, "charge_now");
      const current = num(dir, "current_now");
      if (discharging && toEmpty !== null && toEmpty > 0) minutesLeft = Math.round(toEmpty / 60);
      else if (discharging && energy !== null && draw !== null && draw > 0) minutesLeft = Math.round((energy / draw) * 60);
      else if (discharging && charge !== null && current !== null && current > 0) minutesLeft = Math.round((charge / current) * 60);
      power.batteries.push({ name, status, capacity: num(dir, "capacity"), minutesLeft });
    }
  }
  return power;
}

/** "about 2 hours", "about 1 hour and 40 minutes", "about 25 minutes". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const hours = `${h} hour${h === 1 ? "" : "s"}`;
  return m < 5 ? `about ${hours}` : `about ${hours} and ${m} minutes`;
}

/** What doctor says, and how it counts: ok, a warning, a problem, or information. */
export function powerCheck(power: Power): { status: "ok" | "warn" | "problem" | "info"; text: string } {
  const battery = power.batteries[0];
  if (!battery) {
    return {
      status: "info",
      text:
        power.mains === false
          ? "Power: the mains supply reports no power, and there is no battery"
          : "Power: no battery, so a power cut stops the machine at once (a battery or a small UPS would carry it through a short one)",
    };
  }
  const percent = battery.capacity === null ? "at an unknown charge" : `at ${battery.capacity}%`;
  const onBattery = power.mains === false || (power.mains === null && battery.status === "Discharging");
  if (!onBattery) {
    const state = battery.status === "Charging" ? ", charging" : battery.status === "Full" ? ", full" : "";
    return { status: "ok", text: `Power: on mains; the battery is ${percent}${state}, ready to carry the machine through a power cut` };
  }
  const left = battery.minutesLeft !== null ? `, ${duration(battery.minutesLeft)} left` : "";
  if (battery.capacity !== null && battery.capacity <= LOW_BATTERY_PERCENT) {
    return {
      status: "problem",
      text: `Power: ON BATTERY, and it is low: ${percent}${left}. The machine will switch itself off soon; plug it in now`,
    };
  }
  return { status: "warn", text: `Power: ON BATTERY, ${percent}${left}. The apps keep running; plug the machine in` };
}
