"""Pre-download the speech model (optional): uv run --directory worker python -m clipforge_worker.download_model [small|medium|large-v3-turbo]"""
import sys

from .stages.transcribe import IS_APPLE_SILICON, ensure_model, model_repo


def main() -> None:
    if not IS_APPLE_SILICON:
        print("faster-whisper downloads its model on first use; nothing to do here.")
        return
    repo = model_repo(sys.argv[1] if len(sys.argv) > 1 else "large-v3-turbo")
    print(f"Speech model: {repo}")
    ensure_model(repo, lambda f, msg=None: print(f"\r{msg or 'Downloading'} ({f:.0%})", end="", flush=True))
    print("\nReady — this model is cached and won't download again.")


if __name__ == "__main__":
    main()
