import logging
import re
import ssl
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

# Direct GitHub raw links for reliable downloading of popular creator fonts
_FALLBACK_URLS = {
    "Montserrat": "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
    "Anton": "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
    "Bebas Neue": "https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf",
    "Oswald": "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald%5Bwght%5D.ttf",
    "Roboto": "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf",
    "Inter": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
    "Playfair Display": "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bital%2Copsz%2Cwght%5D.ttf",
    "Courier Prime": "https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Bold.ttf",
    "Plus Jakarta Sans": "https://raw.githubusercontent.com/google/fonts/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf",
    "Rubik": "https://raw.githubusercontent.com/google/fonts/main/ofl/rubik/Rubik%5Bwght%5D.ttf"
}

def _get_ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

def ensure_font(font_family: str) -> Path:
    """Ensure a .ttf font is downloaded to the engine/fonts dir.
    
    Returns the Path to the fonts directory (which is passed to ffmpeg).
    """
    fonts_dir = Path(__file__).parent.parent.parent / "fonts"
    fonts_dir.mkdir(exist_ok=True)
    
    # Simple normalization for filename
    safe_name = "".join(c for c in font_family if c.isalnum())
    font_path = fonts_dir / f"{safe_name}.ttf"
    
    if font_path.exists() and font_path.stat().st_size > 0:
        return fonts_dir

    logger.info("Downloading font: %s", font_family)
    ctx = _get_ssl_context()
    
    url = _FALLBACK_URLS.get(font_family)
    
    # If not in fallback, try to parse Google Fonts CSS using a legacy UA (Firefox 40)
    # This tricks the API into returning TTF links instead of WOFF2.
    if not url:
        css_url = f"https://fonts.googleapis.com/css2?family={font_family.replace(' ', '+')}:wght@700;900&display=swap"
        req = urllib.request.Request(
            css_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.1"}
        )
        try:
            with urllib.request.urlopen(req, context=ctx) as resp:
                css = resp.read().decode("utf-8")
                # Grab the last TTF url (usually the heaviest weight if multiple provided)
                matches = re.findall(r"url\((https://[^)]+\.ttf)\)", css)
                if matches:
                    url = matches[-1]
                else:
                    logger.warning("Could not find TTF url in CSS for %s", font_family)
        except Exception as e:
            logger.warning("Failed to fetch font CSS for %s: %s", font_family, e)

    if url:
        try:
            logger.info("Fetching TTF from %s", url)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=ctx) as resp, open(font_path, "wb") as f:
                f.write(resp.read())
            logger.info("Downloaded %s successfully (%d bytes)", font_family, font_path.stat().st_size)
        except Exception as e:
            logger.error("Failed to download TTF for %s: %s", font_family, e)

    return fonts_dir
