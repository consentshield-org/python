# ConsentShield brand assets

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

Extracted from `consentshield-logos-v2.pdf` (sibling file). Geometry and
colours are 1:1 with `admin/src/components/brand/logo.tsx` (the React
components used inside the product). If this folder and that component
ever drift, the React component wins — re-export from it.

## Files

Shield variants (pure path, portable everywhere):

| File                       | Background       | Shield   | Check  | Use                                 |
| -------------------------- | ---------------- | -------- | ------ | ----------------------------------- |
| `app-icon-primary.svg`     | Navy `#0F2D5B`   | Teal     | White  | Default app icon (iOS/Android/web)  |
| `app-icon-gradient.svg`    | Navy→Teal        | Teal Mid | White  | Hero / splash / marketing           |
| `app-icon-teal-inverse.svg`| Teal `#0D7A6B`   | White    | Teal   | On-brand dark surfaces              |
| `shield-standalone.svg`    | _transparent_    | Teal     | White  | Splash loaders, hero keyframe       |
| `shield-mono-navy.svg`     | _transparent_    | _none_   | Navy   | Print, docs, low-contrast UI        |
| `shield-mono-white.svg`    | _transparent_    | _none_   | White  | Overlays on photography             |

Wordmark + full-logo variants (use `<text>` tags — require Satoshi):

| File                  | Fonts needed                 | Use                               |
| --------------------- | ---------------------------- | --------------------------------- |
| `wordmark-light.svg`  | Satoshi Bold 700             | Light headers, email              |
| `wordmark-dark.svg`   | Satoshi Bold 700             | Dark headers                      |
| `full-logo-light.svg` | Satoshi Bold 700 + DM Sans   | Product surfaces, PDFs, email     |
| `full-logo-dark.svg`  | Satoshi Bold 700 + DM Sans   | Dark-mode headers, marketing hero |

Speciality:

| File                 | Use                                                          |
| -------------------- | ------------------------------------------------------------ |
| `verified-badge.svg` | "ConsentShield VERIFIED" inline badge (seals, case studies)  |
| `social-avatar.svg`  | Circle-crop avatar (Twitter/X, LinkedIn, GitHub org)         |

## Fonts

- **Satoshi** — Bold 700 wordmark (Fontshare, Indian Type Foundry)
- **DM Sans** — Medium 500 tagline + all product UI
- **Cabinet Grotesk** / **Clash Display** — considered and rejected; kept in the PDF for reference

The wordmark SVGs fall back through `Inter → system sans-serif` if Satoshi
isn't loaded. For external surfaces where you can't guarantee the font
(billboards, embeds, third-party email clients with no CSS), open the SVG
in Inkscape and run **Path → Object to Path** to outline the glyphs, or
use `fonttools` to subset-and-outline.

## Palette

| Token        | Hex       | Role                                            |
| ------------ | --------- | ----------------------------------------------- |
| Navy Dark    | `#091E3E` | Gradient start, body text on pure white         |
| Navy         | `#0F2D5B` | Primary bg, "Consent" on light                  |
| Navy Light   | `#1A3F73` | Secondary nav, hover states                     |
| Teal         | `#0D7A6B` | Primary shield fill, "Shield" on light          |
| Teal Mid     | `#14A090` | Gradient shield fill                            |
| Teal Bright  | `#34D399` | Accent, "Shield" on dark                        |
| Teal Light   | `#E0F4F1` | Soft highlight / hover wash                     |
| Slate        | `#94A3B8` | Tagline, secondary text                         |

## Copies

This folder is the source of truth. The same files are mirrored into:

- `app/public/brand/`
- `admin/public/brand/`

so each app can serve them as static assets. If you edit anything here,
re-copy with:

```bash
cp docs/design/brand-assets/*.svg app/public/brand/
cp docs/design/brand-assets/*.svg admin/public/brand/
```
