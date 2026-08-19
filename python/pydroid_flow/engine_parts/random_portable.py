from __future__ import annotations

import math
from typing import Any

_U32_MASK = 0xFFFFFFFF

class _PortableRandom:
    def __init__(self, seed: int = 0):
        normalized = int(seed) & _U32_MASK
        self.state = normalized or 0x6D2B79F5

    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & _U32_MASK
        value = self.state
        value = ((value ^ (value >> 15)) * (value | 1)) & _U32_MASK
        value ^= (value + (((value ^ (value >> 7)) * (value | 61)) & _U32_MASK)) & _U32_MASK
        value &= _U32_MASK
        return ((value ^ (value >> 14)) & _U32_MASK) / 4294967296.0

    def integer(self, minimum: int, maximum_inclusive: int) -> int:
        low = math.ceil(minimum)
        high = math.floor(maximum_inclusive)
        if high < low:
            raise ValueError("Random integer range contains no integer values")
        return low + math.floor(self.next() * (high - low + 1))

    def normal(self, mean: float = 0.0, std: float = 1.0) -> float:
        u1 = max(self.next(), 2.220446049250313e-16)
        u2 = self.next()
        return mean + std * math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)

def _portable_sample_indexes(row_count: int, count: int, replace: bool, seed: int) -> list[int]:
    total = max(0, int(row_count))
    requested = max(0, int(count))
    if not replace and requested > total:
        raise ValueError("Cannot take a larger sample than population when 'replace=false'")
    if requested > 0 and total == 0:
        raise ValueError("Cannot sample from an empty table")
    random = _PortableRandom(seed)
    pool = list(range(total))
    if replace:
        return [pool[math.floor(random.next() * len(pool))] for _ in range(requested)]
    indexes: list[int] = []
    for index in range(len(pool) - 1, len(pool) - 1 - requested, -1):
        swap = math.floor(random.next() * (index + 1))
        pool[index], pool[swap] = pool[swap], pool[index]
        indexes.append(pool[index])
    indexes.reverse()
    return indexes

def _portable_sample_count(row_count: int, fraction: float | None, n: Any) -> int:
    if fraction is None:
        count = int(n)
    else:
        if fraction < 0:
            raise ValueError("Sample fraction must be non-negative")
        count = math.floor(row_count * fraction + 0.5)
    if count < 0:
        raise ValueError("Sample size must be non-negative")
    return count
