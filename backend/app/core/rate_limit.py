"""
Simple in-memory rate limiter for login attempts.
Tracks failed attempts per IP address with a sliding time window.
No external dependencies required.
"""

import time
from collections import defaultdict
from threading import Lock

from app.core.config import settings


class _RateLimiter:
    """Thread-safe in-memory rate limiter."""

    def __init__(self):
        # key = IP address, value = list of timestamps of failed attempts
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _cleanup(self, key: str, now: float) -> None:
        """Remove attempts outside the current time window."""
        window = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
        self._attempts[key] = [t for t in self._attempts[key] if now - t < window]

    def is_blocked(self, key: str) -> bool:
        """Check if this key has exceeded the rate limit."""
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            return len(self._attempts[key]) >= settings.LOGIN_RATE_LIMIT_ATTEMPTS

    def record_failure(self, key: str) -> None:
        """Record a failed login attempt."""
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            self._attempts[key].append(now)

    def reset(self, key: str) -> None:
        """Clear attempts after a successful login."""
        with self._lock:
            self._attempts.pop(key, None)

    def remaining_seconds(self, key: str) -> int:
        """Seconds until the oldest attempt in the window expires."""
        now = time.time()
        with self._lock:
            self._cleanup(key, now)
            if not self._attempts[key]:
                return 0
            oldest = min(self._attempts[key])
            return max(0, int(settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS - (now - oldest)))


# Singleton instance
login_limiter = _RateLimiter()
