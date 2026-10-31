# The benchmark VERIFIER image: Node 22 on glibc and git -- the same pinned base as the runner -- and nothing else: no
# model, no host, no credential and no Orbit. A probe or a gate runs in it with no network at all, the subject or the
# candidate mounted read-only (or as a fresh copy), so what it checks is exactly what was mounted. It also runs the
# run's egress proxy (egress.mjs), the one door a runner has to the model's API. Built with no network.
FROM node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8

COPY egress.mjs /bench/egress.mjs

LABEL orbit.benchmark.image="verifier"
