"""Thin wrapper around the GLM (Z.ai) chat completions endpoint.

All three text-only pipeline steps - clip scoring, Hinglish conversion,
and SEO metadata - go through this one function so retry/error handling
and the "return only JSON" convention live in one place.
"""

import json

import httpx

from clipforge.engine.app.config import GLM_API_BASE, GLM_API_KEY, GLM_MODEL


class GLMError(RuntimeError):
    pass


def call_glm_json(system_prompt: str, user_prompt: str, timeout: float = 300.0) -> dict:
    """Call GLM and parse the response as JSON.

    The system_prompt should explicitly instruct the model to return ONLY
    JSON, no markdown fences, no preamble - see pipeline/clip_select.py for
    an example prompt.
    """
    if not GLM_API_KEY:
        raise GLMError("GLM_API_KEY is not set - add it to engine/.env")

    payload = {
        "model": GLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.3,
    }
    headers = {"Authorization": f"Bearer {GLM_API_KEY}", "Content-Type": "application/json"}

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(f"{GLM_API_BASE}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    try:
        raw = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise GLMError(f"Unexpected GLM response shape: {data}") from e

    import re
    # Try finding markdown code fence first
    code_match = re.search(r"```(?:json)?\s*(.*?)\s*```", raw, re.DOTALL)
    if code_match:
        raw_json = code_match.group(1).strip()
    else:
        # Otherwise find first '{' or '[' to last '}' or ']'
        brace_match = re.search(r"(\{.*\}|\[.*\])", raw, re.DOTALL)
        if brace_match:
            raw_json = brace_match.group(1).strip()
        else:
            raw_json = raw.strip()

    try:
        return json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise GLMError(f"GLM did not return valid JSON: {raw[:300]}") from e
