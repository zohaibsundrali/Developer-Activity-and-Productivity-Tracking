# Desktop release readiness and tracking disclosures

The companion desktop change adds a Windows packaging workflow, allowlisted
public configuration, build failure propagation and packaged offline diagnostics.
It does not assert that a Windows installer or live enrollment test has passed.

The web copy now describes implemented pause/resume/stop controls, recorded breaks,
organization screenshot enable/interval controls, continuing device presence,
offline queued synchronization, website-label/domain collection and twelve roles.
It no longer describes same-organization monitoring as protected only by UI filters.
No privacy controls or capture exclusions are invented by the wording changes.

No database migration is introduced by this web change. Existing deployed RLS,
device enrollment and tracking migrations still require the operator's current
verification. The broader sequence is in hubstaff-feature-roadmap.md.
