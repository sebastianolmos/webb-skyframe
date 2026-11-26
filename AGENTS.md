# Contributor guide

Read the [architecture](docs/architecture.md) for ownership, selection and HTTP semantics, the [card design](docs/card-design.md) for units and contracts, and the [increment plan](docs/increments.md) for delivery order. Pick the first incomplete increment whose dependencies have evidence. Keep its runnable result small enough to demonstrate end to end.

Inspect status and existing instructions before editing. Preserve owner changes, including untracked mockups and scratch inputs. Treat local Python experiments as read-only evidence. Keep examples free of credentials and deployment-specific secrets.

Keep the renderer pure. Supply versioned inputs and an embedded raster, use one design on both clients and keep upstream astronomy calls off the request path. Preserve physical marker positions, frame, time basis and WCS mapping. Record unknown values explicitly. Publish complete dependencies before the catalog pointer. Keep a single durable shared rendered card and isolate portfolio selection per tab.

Version schema changes, input bundles, filter rules, catalogs and rendering independently. Change card URLs when any visible dependency changes. Update the contract and migration or retirement behavior with each incompatible change.

Use synthetic fixtures for fast geometry, rendering and failure checks. At increment 4 verify a real calibrated FITS with its WCS and ephemerides. Before marking a slice complete, demonstrate its normal entry point, exercise its failure cases and record reproducible inputs, versions, checks and observed results (including visual captures or real proxy timings where relevant). Put verified setup and run commands in the README and link evidence from the increment. Describe proposed tools as planned until installed and tested.
