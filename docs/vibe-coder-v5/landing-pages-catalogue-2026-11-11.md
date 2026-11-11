# Clyra Code — Landing Pages category (11 November 2026)

## Scope and source

Add **75 separate GitHub source repositories** as templates under the single
**Landing Pages** marketplace category, alongside the 50 existing sources.
Each one can be cloned individually using its own GitHub repository, rather
than downloading an unrelated monorepo. Source curator:
[uiuxlabz/uiuxlabz](https://github.com/uiuxlabz/uiuxlabz) (120-template
catalogue). Selected entries are maintained in
`lib/clyra-code/library/landing-pages.ts`.

Subcategories (UI-filterable) and selected counts:

| Business type | Count |
| --- | ---: |
| SaaS & AI | 8 |
| Apps & Products | 3 |
| Agencies & Business | 10 |
| Retail & E-commerce | 6 |
| Food & Restaurants | 7 |
| Real Estate & Interiors | 5 |
| Health & Wellness | 5 |
| Travel & Hospitality | 4 |
| Portfolios | 4 |
| Home & Local Services | 5 |
| Education | 3 |
| Finance & Legal | 4 |
| Fitness & Sport | 2 |
| Events & Lifestyle | 3 |
| Energy & Sustainability | 2 |
| Logistics & Delivery | 2 |
| Automotive | 2 |
| **Total** | **75** |

## Actual screenshot proof and local performance

Every selected GitHub repository has its own `screenshot.png`. The capture
workflow `.github/workflows/clyra-landing-page-previews.yml` runs
`tools/capture-landing-page-screenshots.py` and:

1. Downloads each **upstream-authored screenshot.png** over HTTPS, validating
   its PNG header, decode and minimum dimensions.
2. Converts only this **actual upstream image** to a 1200×750 JPEG of
   roughly 6 MB for all 75 screenshots. It does **not** invent a page image.
3. Saves a local, immutable build asset as
   `public/library-shots/landing-<source>.jpg`; no third-party API key or
   iframe is required to show a thumbnail.
4. Fails the entire CI task if any of the 75 images is missing, invalid or too
   small and commits all 75 to the existing development branch.
5. Labels provenance as **author-provided**, not as a Clyra local screenshot or
   evidence that an imported source has been built or executed.

The UI links to each source repository and its original public GitHub Pages
live demo; those pages may change or become unavailable independently.

## UI and import behaviour

- **Landing Pages** is a new first-class category with screenshot gallery
  and 17 lightweight industry filters. Users can search by title and
  description and inspect a template's larger screenshot and source credit.
- The Discover screen displays only a small first row of landing templates;
  opening the category gives access to all 75 without loading enormous
  original images.
- `/api/clyra-code/library` now allows up to 250 records per request (125
  currently), so the marketplace, Installed view and category filters can
  see the entire set. API pagination remains supported for future growth.
- **Get** keeps the existing safe clone-and-inspect flow. The app does not
  run arbitrary install scripts on click, and author screenshots must not
  turn a record's `status` into `runnable-now`.

## Licences and limitations

The uiuxlabz upstream README files state **MIT**; the catalogues are labelled
`MIT (README)` rather than asserting that a root LICENSE file has been
verified for every clone. Check the particular upstream revision and any
third-party photos, fonts, logos, trademarks and dependencies before
commercial publication. Preview screenshots do not transfer ownership of
these images, and Clyra is unaffiliated with uiuxlabz.

A screenshot proves only that a source repository published that image;
**it does not prove a working local build**, accessible forms, functional
bookings, or correct integration into the Clyra application. Automated Clyra
tests cover manifest integrity, local image files, category filtering, preview
links, actual UI gallery rendering and basic import contracts. Production
launching of every upstream repo remains a separate verification task.

## Test commands

```bash
npm run test:clyra-code-library
npx tsc --noEmit
npm run build
npx playwright test -c playwright.clyra-code.config.ts tests/clyra-code/library.spec.ts
```

The existing GitHub Actions workflow `clyra-code-checks.yml` performs those
tests alongside responsive screenshot checks (320, 375, 768, 1024 and 1440px).
