import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ENGINE_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = ENGINE_ROOT / "jobs"
PRESETS_FILE = ENGINE_ROOT / "presets.json"

GLM_API_KEY = os.getenv("GLM_API_KEY", "")
GLM_API_BASE = os.getenv("GLM_API_BASE", "https://api.z.ai/api/paas/v4")
GLM_MODEL = os.getenv("GLM_MODEL", "glm-4.5-flash")

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "medium")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")  # "cuda" if you have a GPU
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

JOBS_DIR.mkdir(parents=True, exist_ok=True)
