# Third-party software Orbit Web runs beside itself

Orbit Web's own images are built from `docker/Dockerfile`; what they contain is listed by `npm ls` and the image's
package manager, and is not repeated here. This file names the software an Orbit Web deployment **pulls and runs as a
separate container** without building or redistributing it, why it is there, and the terms it comes under.

## Tetragon (runtime security sensor, Orbit Web 0.8.1)

| | |
|---|---|
| what | Cilium Tetragon, an eBPF-based security observability and runtime enforcement agent |
| version | v1.8.0 |
| image | `quay.io/cilium/tetragon:v1.8.0@sha256:5ed9088a1582131d71b06c98e0d549a37a71ae63ab13aabefc7a47553c822a9d` (multi-architecture index: linux/amd64, linux/arm64) |
| source | <https://github.com/cilium/tetragon> (tag `v1.8.0`) |
| licence | Apache License 2.0 for the userspace code (the repository's root `LICENSE`). The eBPF programs under `bpf/` are dual-licensed GPL-2.0 and BSD-2-Clause (`bpf/LICENSE.GPL-2.0`, `bpf/LICENSE.BSD-2-Clause`), as the kernel requires of programs that use GPL-only helpers. |
| where it is named | `docker/compose.runtime-security.yaml` (the sensor service) and `apps/api/src/allocator/runtime-security/tetragon.ts` (`TETRAGON_IMAGE`, the same reference) |
| used when | only when an operator adds `compose.runtime-security.yaml` to the deployment (ADR 0063). Without it nothing of Tetragon is pulled or run. |

Orbit Web does not modify, rebuild or redistribute Tetragon: the image is pulled from its publisher by digest, so what
runs is byte for byte what Cilium published under that digest. Orbit Web talks to it only through its documented
interfaces -- the `tetra` CLI against the sensor's unix socket (run by the allocator inside the sensor's own container),
TracingPolicy documents, and the JSON export file -- and links none of its code.

Changing the pin is a reviewed change: update the reference in both places above (a test asserts they agree), re-run the
proof of concept (`node tests/runtime-security/poc.mjs`) and the real-kernel tier on the new image, and record the
results beside the release, because what a kernel enforces is a property of the sensor version and the kernel together.
