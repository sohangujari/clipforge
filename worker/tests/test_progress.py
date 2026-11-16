from clipforge_worker.progress import Throttle


def test_throttle():
    t = Throttle(min_interval=10)
    assert t.should_write(0.1) is True
    assert t.should_write(0.2) is False
    assert t.should_write(1.0) is True
