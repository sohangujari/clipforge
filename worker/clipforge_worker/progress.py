import time


class Throttle:
    """Limits DB progress writes; always lets the first and the final (>= 1.0) update through."""

    def __init__(self, min_interval: float = 0.5):
        self.min_interval = min_interval
        self.last = None

    def should_write(self, fraction: float) -> bool:
        now = time.monotonic()
        if self.last is None or fraction >= 1.0 or now - self.last >= self.min_interval:
            self.last = now
            return True
        return False
