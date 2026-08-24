# Easy Flash component contract

`easy-flash/component-lock.json` pins the physically accepted whole Easy Flash preview at `987c1f7` (tree `e913cadb...`). The manifest hashes the browser shell, Flash/runtime modules, server, vendor bundle, maintainer Status surface, and preview build/routing scripts. Its receipt target map pins all three target IDs and USB artifact hashes.

Only Diagnose-local iteration is allowed: `easy-flash/diagnose.mjs` and Diagnose-only tests/helpers. Do not add helpers imported by `app.mjs`. Any frozen-file, UI-surface, or receipt target change fails `npm test`; intentional Status/receipt changes require an explicit lock update containing all three target IDs and hashes. This lock changes no runtime behavior and does not regenerate `dist`.
