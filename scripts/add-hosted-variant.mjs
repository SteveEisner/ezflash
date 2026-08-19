#!/usr/bin/env node
// Augments a built release manifest with extra catalog variants (e.g. Waveshare S3) by
// copying the verified firmware binary into the release and recording its exact SHA.
// Usage: node scripts/add-hosted-variant.mjs --release <id> --variant <path-to-variant.json>
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, basename } from "node:path";

const args = process.argv.slice(2), value = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = resolve(".");
const release = value("--release");
const variantPath = value("--variant");
if (!release || !/^[a-z0-9][a-z0-9._-]*$/i.test(release)) throw Error("--release required and must be a valid immutable id");
if (!variantPath) throw Error("--variant path to the variant JSON is required");

const releaseRoot = resolve(root, "dist", "releases", release);
const manifestPath = resolve(releaseRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const variant = JSON.parse(await readFile(variantPath, "utf8"));

const prefix = `releases/${release}/firmware/`;
const artifact = variant.artifacts.find(({ transport, kind }) => transport === "usb" && kind === "complete-merged-image");
if (!artifact) throw Error("variant must carry exactly one usb complete-merged-image");
const abs = resolve(variantPath, "..", artifact.path);
const bytes = await readFile(abs);
const actual = createHash("sha256").update(bytes).digest("hex");
if (actual !== artifact.sha256) throw Error(`SHA mismatch for ${artifact.path}: expected ${artifact.sha256}, got ${actual}`);

await mkdir(resolve(releaseRoot, "firmware"), { recursive: true });
const name = basename(artifact.path);
await cp(abs, resolve(releaseRoot, "firmware", name));
artifact.path = `${prefix}${name}`;

const existing = manifest.variants.findIndex((v) => v.id === variant.id);
if (existing >= 0) manifest.variants[existing] = variant; else manifest.variants.push(variant);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`added ${variant.id} to ${release}; ${name} (sha ${actual.slice(0, 16)}...)`);