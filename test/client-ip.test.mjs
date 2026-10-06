import { test } from "node:test";
import assert from "node:assert/strict";

import { getClientIp } from "../dist/index.js";
import { getClientIp as fromClientEntry } from "../dist/client/index.js";

const VISITOR = "41.100.207.229";

test("reads x-real-ip from a Fetch Request", () => {
  const request = new Request("https://app.example/", { headers: { "x-real-ip": VISITOR } });
  assert.equal(getClientIp(request), VISITOR);
});

test("reads it from a Headers (next/headers)", () => {
  assert.equal(getClientIp(new Headers({ "X-Real-IP": ` ${VISITOR} ` })), VISITOR);
});

test("reads it from a Node request's plain headers object", () => {
  assert.equal(getClientIp({ headers: { "x-real-ip": "2001:db8::1" } }), "2001:db8::1");
});

test("never falls back to x-forwarded-for", () => {
  const request = new Request("https://app.example/", { headers: { "x-forwarded-for": VISITOR } });
  assert.equal(getClientIp(request), undefined);
});

test("a list or a non-IP is undefined, not a guess", () => {
  assert.equal(getClientIp(new Headers({ "x-real-ip": `${VISITOR}, 10.0.0.1` })), undefined);
  assert.equal(getClientIp({ headers: { "x-real-ip": ["1.2.3.4", "5.6.7.8"] } }), undefined);
  assert.equal(getClientIp({ headers: { "x-real-ip": "unknown" } }), undefined);
  assert.equal(getClientIp({ headers: {} }), undefined);
});

test("the client entry exports the same helper", () => {
  assert.equal(fromClientEntry(new Headers({ "x-real-ip": VISITOR })), VISITOR);
});

test("only one valid IP address comes back", () => {
  for (const value of ["cafe", "1.2.3", "1.2.3.4:8080", "::::", "999.999.999.999"]) {
    assert.equal(getClientIp({ headers: { "x-real-ip": value } }), undefined, value);
  }
  for (const value of [VISITOR, "2001:db8::1", "::ffff:41.100.207.229"]) {
    assert.equal(getClientIp({ headers: { "x-real-ip": value } }), value);
  }
});

test("a zone id or a leading zero is not one valid address", () => {
  assert.equal(getClientIp({ headers: { "x-real-ip": "fe80::1%eth0" } }), undefined);
  assert.equal(getClientIp({ headers: { "x-real-ip": "041.100.207.229" } }), undefined);
});

test("a single-element array is that one value", () => {
  assert.equal(getClientIp({ headers: { "x-real-ip": [VISITOR] } }), VISITOR);
});

test("reads any Headers-like object with a get function", () => {
  const polyfill = { get: (name) => (name === "x-real-ip" ? VISITOR : null) };
  assert.equal(getClientIp(polyfill), VISITOR);
  assert.equal(getClientIp({ headers: polyfill }), VISITOR);
});

test("plain header objects match the name in any case", () => {
  assert.equal(getClientIp({ headers: { "X-Real-IP": VISITOR } }), VISITOR);
  assert.equal(getClientIp({ headers: { "X-Real-IP": VISITOR, "x-real-ip": "10.0.0.1" } }), undefined);
});

test("a request's own headers win over its get method", () => {
  const req = { headers: { "x-real-ip": VISITOR }, get: () => undefined };
  assert.equal(getClientIp(req), VISITOR);
});
