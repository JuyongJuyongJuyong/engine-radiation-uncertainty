# engine-radiation-uncertainty

Part of the Global Rooftop Solar Potential Calculator (3-repo split — see `ARCHITECTURE.md` in the project's docs for how this repo fits with `engine-system-economics` and `app-rooftop-solar`). This repo is a published JS/TS **package**, not a running service — see ARCHITECTURE.md's "Important: these are packages, not services" section before assuming anything here talks to another repo over a network.

Owner: A (sole owner — see repo's CODEOWNERS).

## Non-negotiable constraints (shared across all three repos)
- Zero-cost stack only: no paid APIs in the default path, no backend server.
- Never claim precision the data doesn't support — every exported result carries an uncertainty range and a comment citing its data source.

## Scope — physics AND math/statistics, not one or the other
- **Physics**: solar geometry (sun position — declination via Cooper's equation, hour angle → altitude/azimuth; near-zero error, don't "simplify" this part), GHI→POA transposition (Liu-Jordan isotropic baseline, Erbs correlation for diffuse/beam split, Perez anisotropic upgrade path), dust/aerosol correction to GHI, irradiance ensembling across multiple free sources, and the tiered irradiance-source routing that decides which sources to use.
- **Math/statistics**: whole-system Monte Carlo uncertainty propagation and accuracy validation (`monte_carlo.py` is the reference implementation — port its logic, don't re-derive from scratch). This is what quantifies how confident the physics above actually is.

## Data-source implementation notes
- **Dust/aerosol correction**: Open-Meteo's Air Quality API (free, no key for non-commercial use, ships `dust` and `aerosol_optical_depth` as hourly variables). Same request pattern as irradiance ensembling. Replaces raw CAMS/MERRA-2 file handling entirely. Verify CORS with one real browser fetch before relying on it.
- **Irradiance ensembling**: NASA POWER (no documented rate limit, but the team monitors for fair use) + Open-Meteo (free non-commercial tier: 600/min, 5,000/hr, 10,000/day, 300,000/month — becomes a paid product if this ever monetizes) + PVGIS (free, no key). Ensemble at least two of these per Tier 1/2 lookup.
- **Tier 1 irradiance**: PVGIS/NSRDB-grade.

## Accuracy target (already validated by Monte Carlo — don't re-derive, just hit it)
- Tier 1: ~±11% energy (90% CI)
- Tier 3: ~±16% energy (90% CI)
- If a change measurably worsens these, treat it as a regression.

## Exported interface (consumed by `engine-system-economics` — see ARCHITECTURE.md)
- Input: `{ lat, lng, tier }` (or equivalent location + tier descriptor).
- Output: `{ kWh_per_m2_per_year, uncertainty_ci_90, ...intermediate values engine-system-economics needs (clearness index, transposition factor) }`.
- Any change to this shape needs a version bump here and a coordinated PR on `engine-system-economics`.

## Before merging any PR
- Run `/code-review` on the diff.
- Check: does every displayed/exported number carry a source and an uncertainty range? Does any new assumption have a comment citing where it came from?
