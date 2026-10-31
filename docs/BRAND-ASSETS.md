# Brand assets — icons and the link preview

What a browser tab, a bookmark, a phone home screen and a shared link show for
`samo.md.kku.ac.th`. All files live in `public/` and are served from the site
root; the Passport pages and `/admin/` point at the same files.

| File | Used by | Made from |
|---|---|---|
| `favicon.svg` | modern browser tabs, bookmarks | the guidebook's REVERSE mark — white + orange on a `#105922` rounded square — built from the paths of `Logo_full HD.svg` |
| `favicon.ico` (16/32/48) | older browsers, some bookmark managers | `favicon.svg` via `rsvg-convert` + ImageMagick |
| `apple-touch-icon.png` (180) | iPhone/iPad "Add to Home Screen" | `favicon.svg` with square corners (iOS rounds them itself, and fills transparency black) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `site.webmanifest` (Android home screen) | same; the maskable one is full-bleed with the mark shrunk into the round crop's safe zone |
| `og-image.png` (1200×630) | LINE, Facebook, Discord, X link previews | `tools/brand/og-image.html`, screenshotted by headless Chrome |

The tags are in the `<head>` of `index.html` (and `passport/index.html`). They
must stay static HTML: no link-preview crawler runs the app's JavaScript.
`og:image` is an ABSOLUTE URL for the same reason.

⛔ **Never the green mark on a transparent background for an icon.** It was the
first version: on a dark tab bar `#105922` reads as black and the mark vanishes
(owner, 2026-10-31: "it's hard to see"). An icon sits on a background we do not
choose, so it carries its own.

**Colours** are the logo pack's: green `#105922`, orange `#FF6F30`, yellow
`#FDC55A`, beige `#F6F3EE`.

## Regenerating the preview card

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=8000 \
  --user-data-dir="$(mktemp -d)" --screenshot=og.png "file://$PWD/tools/brand/og-image.html"
magick og.png -strip -colors 256 PNG8:public/og-image.png
```

`--virtual-time-budget` gives the Google fonts time to load; without it the Thai
line renders in a fallback face.

**After changing the image, the old one stays cached** by LINE and Facebook for
days. Facebook re-reads on demand at developers.facebook.com/tools/debug; LINE
has no tool — a changed file NAME (`og-image-2.png`) is the reliable reset.
