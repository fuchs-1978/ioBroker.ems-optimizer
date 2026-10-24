# Offline go-e fixture

`main.js.txt` is the unmodified `main.js` from
MK-2001/ioBroker.go-e commit `aca7fbdeaa4704bb9dd035597d95bf9ab0215d29`
(package version 1.0.42), Git blob `9b130f277bd5885034e2f1050af297becf99e60d`.
Copyright 2024 MK-2001. Apache-2.0; original license included in `LICENSE`.
The fixture is test data, not an EMS runtime dependency or installed adapter.

`test/go-e-status-order.test.js` checks the blob identity, applies the proposed
patch in an isolated temporary directory, and runs the actual adapter code in
a VM with mocked HTTP, ioBroker state writes, schema and queue dependencies.
No network, live ioBroker connection or device command is used.

The patch changes request/publication ordering; its changed-file notice is in
the patch. It has not been accepted or released by the upstream maintainer.
