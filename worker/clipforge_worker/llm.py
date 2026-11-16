"""Calls the user's AI model through Next's /api/internal/llm (one provider layer, keys never leave Next)."""
import json
import os
import secrets
import urllib.error
import urllib.request

from .paths import data_dir


class LlmUnavailable(Exception):
    """No model configured, or the web app isn't reachable. Callers degrade gracefully."""


class LlmError(Exception):
    """The model or provider failed."""


class LlmTimeout(LlmError):
    """The model took too long (e.g. a local model under memory pressure). Skip that part, keep going."""


class RateLimited(LlmError):
    """The provider asked us to slow down (or is temporarily overloaded: busy=True)."""
    def __init__(self, retry_after: float, busy: bool = False):
        super().__init__(f"{'busy' if busy else 'rate limited'}, retry after {retry_after}s")
        self.retry_after, self.busy = retry_after, busy


class QuotaExhausted(LlmError):
    """The provider's daily (free-tier) quota is used up."""


def ensure_token() -> str:
    """Shared secret with the web app. Whichever side runs first creates it (exclusive create, 0600); both read it back."""
    path = data_dir() / ".worker-token"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    return path.read_text().strip()


def call_llm(task: str, payload: dict, timeout: float = 120) -> dict:
    return call_llm_ex(task, payload, timeout)[0]


def call_llm_ex(task: str, payload: dict, timeout: float = 600) -> tuple[dict, bool]:
    """(output, is_local) — is_local tells the caller to use small windows/batches."""
    port = os.environ.get("CLIPFORGE_WEB_PORT", "3000")
    token = ensure_token()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/internal/llm", method="POST",
        data=json.dumps({"task": task, "input": payload}).encode(),
        headers={"Content-Type": "application/json", "X-ClipForge-Token": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())["output"], r.headers.get("X-ClipForge-Local") == "1"
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b"{}")
        except ValueError:  # e.g. an HTML error page from Next
            body = {}
        if e.code == 424:
            raise LlmUnavailable(body.get("error", "no_model")) from e
        if e.code == 429 and body.get("error") == "quota":
            raise QuotaExhausted(body.get("message") or "Daily quota reached") from e
        if e.code == 429:
            raise RateLimited(float(body.get("retryAfter") or 30), busy=body.get("error") == "busy") from e
        raise LlmError(body.get("error") or f"HTTP {e.code}") from e
    except TimeoutError as e:
        raise LlmTimeout(f"no answer after {timeout:.0f}s") from e
    except urllib.error.URLError as e:
        if isinstance(e.reason, TimeoutError):
            raise LlmTimeout(f"no answer after {timeout:.0f}s") from e
        raise LlmUnavailable(f"web app unreachable: {e}") from e
    except ConnectionError as e:
        raise LlmUnavailable(f"web app unreachable: {e}") from e
