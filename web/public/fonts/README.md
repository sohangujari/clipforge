# Bundled subtitle fonts

Static TTFs used by both the editor preview (JASSUB) and the export (FFmpeg/libass), so subtitles look the same in both.

- Montserrat, Anton, Inter, Poppins, Courier Prime, Bebas Neue, Geist, Noto Sans Devanagari (fallback for Hindi captions)
- Source: [Fontsource](https://fontsource.org) per-weight builds (latin subset; Devanagari subset for Noto Sans Devanagari)
- Licence: SIL Open Font License 1.1, see `licenses/OFL-*.txt`. None of these fonts declares a Reserved Font Name.

After adding or replacing a font, regenerate the index the subtitle generators read:

```bash
uv run --with fonttools python web/scripts/fonts-index.py
```
