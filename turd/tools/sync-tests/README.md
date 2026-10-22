# Device sync two-device test (Device sync thread)

Runs the real `server/server.js` (temp DATA_DIR) and the real web app in two isolated
browser contexts: a Windows PC and a Galaxy Fold4 (plus a third operator for isolation).
22 checks: first-link merge, live updates into an open section, simultaneous edits,
offline edits that merge on reconnect, counters, raw values, secrets never syncing,
per-operator isolation, lock + re-login, and the Fold status strip on the PC's Home.

Setup once (scratch dir): `mkdir deps && cd deps && npm init -y && npm i three@0.160.0`
and link the global playwright into deps/node_modules. Put this folder next to deps/
(it loads `../deps/node_modules/three`), then:

    node twodev.mjs /mnt/project-files/turd        # exit code 0 = all pass
