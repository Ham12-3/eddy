"""Per-student rate limits on tutor messages (SPEC.md section 9.2, step 1), in Redis.

Fixed windows: a minute and a day, counted with INCR and expired with EXPIRE, so the limit holds
across API processes. If Redis cannot be reached the limiter falls back to counting in this
process: a little looser across processes, but never no limit at all.
"""

import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Protocol

import redis

logger = logging.getLogger(__name__)
WINDOWS = (("minute", 60), ("day", 86_400))


class Limiter(Protocol):
    def allow(self, key: str) -> bool: ...


@dataclass
class MemoryLimiter:
    per_minute: int
    per_day: int
    counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = now if now is not None else time.time()
        current = {f"{name}:{int(moment // seconds)}" for name, seconds in WINDOWS}
        # Only the current windows are kept, so memory stays bounded. A bucket ends with its
        # window ("minute:28441"); the key before it may hold colons of its own.
        for stale in [b for b in self.counts if ":".join(b.rsplit(":", 2)[1:]) not in current]:
            del self.counts[stale]
        allowed = True
        for (name, seconds), limit in zip(WINDOWS, (self.per_minute, self.per_day), strict=True):
            bucket = f"{key}:{name}:{int(moment // seconds)}"
            self.counts[bucket] += 1
            allowed = allowed and self.counts[bucket] <= limit
        return allowed


@dataclass
class RedisLimiter:
    client: redis.Redis
    per_minute: int
    per_day: int
    fallback: MemoryLimiter

    @classmethod
    def from_url(cls, url: str, per_minute: int, per_day: int) -> "RedisLimiter":
        client = redis.Redis.from_url(url, socket_timeout=0.5)
        return cls(client, per_minute, per_day, MemoryLimiter(per_minute, per_day))

    def allow(self, key: str) -> bool:
        now = time.time()
        try:
            pipe = self.client.pipeline()
            buckets = []
            for name, seconds in WINDOWS:
                bucket = f"eddy:tutor:{key}:{name}:{int(now // seconds)}"
                buckets.append(bucket)
                pipe.incr(bucket)
                pipe.expire(bucket, seconds)
            results = pipe.execute()
        except redis.RedisError:
            logger.warning("Redis unavailable: tutor rate limits counted in this process")
            return self.fallback.allow(key, now)
        minute, day = int(results[0]), int(results[2])
        return minute <= self.per_minute and day <= self.per_day
