# Fixed Versions and Sources

Checked: 2026-08-18

The release tag is the version authority for this study. A documentation page
may describe a newer or older behavior, so the observed build and its exact
version must be recorded separately.

| Product | Fixed version | Release source | Primary documentation | Study status |
|---|---|---|---|---|
| Ghostfolio | `3.36.0` | [release 3.36.0](https://github.com/ghostfolio/ghostfolio/releases/tag/3.36.0) | [repository README](https://github.com/ghostfolio/ghostfolio/blob/main/README.md) | Official release tag and pinned-digest isolated S1 run verified; authenticated Demo home/portfolio/activities/account routes captured at 390px; full keyboard/reduced-motion follow-up pending |
| Wealthfolio | `v3.6.2` | [release v3.6.2](https://github.com/wealthfolio/wealthfolio/releases/tag/v3.6.2) | [CSV import](https://wealthfolio.app/docs/guide/csv-import/), [tracking modes](https://wealthfolio.app/docs/concepts/tracking-modes/), [export and backup](https://wealthfolio.app/docs/guide/data-export/) | Official DMG, T01-T04/T06-T08 and partial T10 isolated run verified; fixed-build navigation check found no source-replacement or public-share action; narrow Activities/Appearance and keyboard paths captured; reduced motion remains pending |
| Portfolio Performance | `0.86.0` | [release 0.86.0](https://github.com/portfolio-performance/portfolio/releases/tag/0.86.0) | [TTWROR](https://help.portfolio-performance.info/en/concepts/performance/time-weighted/), [performance report](https://help.portfolio-performance.info/en/reference/view/reports/performance/), [export](https://help.portfolio-performance.info/en/reference/file/export/) | Official release tag, isolated UI run, 11-entry ledger/XML export and 392x700 narrow capture verified; keyboard/reduced-motion and public-share follow-up pending |

## Source Notes

- Ghostfolio's release page identifies `3.36.0` as the latest release in the
  checked snapshot. The repository landing page may show a stale cached release
  label; the explicit release tag is used here. The `3.36.0` compose file
  references the Docker image tag `latest`, so an isolated run must pin the
  image digest or an equivalent `3.36.0` image before recording S1 evidence.
- Wealthfolio's `v3.6.2` release is the fixed build. Its import documentation
  describes upload, mapping, asset review, activity review, and final import as
  separate steps, plus duplicate fingerprinting and export/backup paths.
  The public download page currently points at `v3.6.0`, so the release asset
  must be obtained from the explicit `v3.6.2` tag rather than the landing-page
  default.
- Portfolio Performance `0.86.0` is the fixed calculation reference. Its
  manual defines daily TTWROR with inflows at the start of the day and outflows
  at the end of the day, and distinguishes portfolio-level external flows from
  internal dividend and sale movements.

## Capture Record

For each product, append an observation record with:

- exact app version and build identifier;
- operating system and screen size;
- profile/file identifier that contains no personal data;
- fixture filename and SHA-256 hash;
- task ID, start/end timestamps, and result;
- screenshot or export path under a local-only artifact directory;
- evidence level and unresolved questions.

## Local Artifact Verification

The following assets were downloaded from the official release/tag URLs on
2026-08-18 and kept outside the repository:

| Artifact | SHA-256 / digest |
|---|---|
| Ghostfolio 3.36.0 container | `sha256:b53ebfe00de1510decbed4ca3310b3d6292d419bb906a7d749ec7e8bcc48cdce` |
| Wealthfolio `v3.6.2` Apple Silicon DMG | `a2e2f58f2cbdfc52cdf46979bcc699a6ba03273f62fe05ea0cb5b6cba9776c11` |
| Portfolio Performance `0.86.0` Apple Silicon DMG | `ada742fda4be39ba06a126cd8216aa67f3a22eeb616da8303d6b42edd6d3c0a7` |
| Wealthfolio synthetic run CSV | `3c151633369489a6ceb43656bd949fdd3c9460337d432c0aa7cbcaa552c367c3` |
| Ghostfolio synthetic run JSON | `be210e7040782ddd50197e7bc03b72357cbe2e74753bbde5900b20756d879f8b` |
| Ghostfolio 390px login screenshot | `d57f15c57827c75a620e69aae24fa3673234ff1dc4706f869e46412fe01ad933` |
| Ghostfolio Demo home 390px screenshot | `e14929bbfe7223764cbc145c181e367db6ffcbaf563bd31404155f3bcd81cc9d` |
| Ghostfolio Demo portfolio 390px screenshot | `94c5c5acaf193397dd4e32eef5a4a7440dc338b4a1db311315abb0675c368a00` |
| Ghostfolio Demo activities 390px screenshot | `163ceb4a57d0a7cf427207e26da39692af58074db720724e5f7fe12c46663e8c` |
| Ghostfolio Demo account 390px screenshot | `a108fb6a50cdb1b56a3a4f69739816e2aeebd2ac34569176b0f23350e4518acd` |
| Ghostfolio Demo keyboard tabs 390px screenshot | `7cac8fc76a094f1f0a47a8f93fe7240a8483e139e62de249fa6a99fe0ea782ee` |
| Wealthfolio repeat SQLite backup | `94d75ef1eef6c2fb600fae820ee1e397e3b3810c231f45ad9bf5b28679ef8078` |
| Wealthfolio repeat activities CSV export | `1b181d9ca9379d7b87783fc0ec6284b3f71c2787c7a72566ab53835bd702e96b` |
| Wealthfolio final 14-activity CSV export | `37ef70702ec631263a76024ec863e63b4f3c446d3e05e6587519db7aa39aca64` |
| Wealthfolio incremental fixture | `0ee20448de90e4cd0224597dcf16590741573046a16ed7f9dd297a736079604d` |
| Wealthfolio keyboard focus screenshot | `88351db0cc9c798f5eea8d793207fd0ffa1405df7757b02cbec38f37e99c81f0` |
| Wealthfolio narrow keyboard screenshot | `9f41b4b219dddc19bab1f333ec91e9903740901dc8bd475993761604598cc9d1` |
| Wealthfolio narrow Appearance screenshot | `0df7154da4e52406980a27341aafd959941d41fc70d336cb3124f6c1c6778ca0` |
| Portfolio Performance portfolio-transaction fixture | `33edfad4ee35ecbd03a2779b2ad37018e24b3ae4256f85aa9276f01fbfd9acee` |
| Portfolio Performance account-transaction fixture | `9b1fd52a5246a719480e2797f13d566dbb55f38a6aa069b4326dfcd405383f72` |
| Portfolio Performance narrow-window screenshot | `e36b300142e1d2013c1892d7c24c4647706d6585ec75e19e140939a211d553bc` |
