export class PortableRandom {
  private state: number;

  constructor(seed = 0) {
    const normalized = Math.trunc(Number(seed)) >>> 0;
    this.state = normalized || 0x6d2b79f5;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  integer(minimum: number, maximumInclusive: number): number {
    const low = Math.ceil(minimum);
    const high = Math.floor(maximumInclusive);
    if (high < low) throw new Error("Random integer range contains no integer values");
    return low + Math.floor(this.next() * (high - low + 1));
  }

  normal(mean = 0, std = 1): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

export function portableSampleIndexes(rowCount: number, count: number, replace: boolean, seed: number): number[] {
  const total = Math.max(0, Math.trunc(rowCount));
  const requested = Math.max(0, Math.trunc(count));
  if (!replace && requested > total) throw new Error("Cannot take a larger sample than population when 'replace=false'");
  if (requested > 0 && total === 0) throw new Error("Cannot sample from an empty table");
  const random = new PortableRandom(seed);
  const pool = Array.from({ length: total }, (_, index) => index);
  if (replace) return Array.from({ length: requested }, () => pool[Math.floor(random.next() * pool.length)]);
  const indexes: number[] = [];
  for (let index = pool.length - 1; index > pool.length - 1 - requested; index -= 1) {
    const swap = Math.floor(random.next() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
    indexes.push(pool[index]);
  }
  indexes.reverse();
  return indexes;
}

export function portableSampleCount(rowCount: number, fraction: number | null, n: number): number {
  let count: number;
  if (fraction === null) count = Math.trunc(n);
  else {
    if (!Number.isFinite(fraction) || fraction < 0) throw new Error("Sample fraction must be non-negative");
    count = Math.floor(rowCount * fraction + 0.5);
  }
  if (!Number.isFinite(count) || count < 0) throw new Error("Sample size must be non-negative");
  return count;
}
