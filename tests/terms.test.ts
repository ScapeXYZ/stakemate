import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeChallengeTerms, hashCanonicalChallengeTerms } from "../src/lib/terms";

const terms = { creator: `0x${"01".repeat(32)}`, opponent: `0x${"02".repeat(32)}`, stakeMist: BigInt(123456789), fixture: "Demo FC vs Example United", market: "Home win", fundingDeadlineMs: BigInt(1700000000000), outcomeDeadlineMs: BigInt(1700003600000), outcomeAuthority: `0x${"03".repeat(32)}` };

test("canonical challenge terms have a stable UTF-8 SHA-256 test vector", async () => {
  assert.equal(canonicalizeChallengeTerms(terms), `stakemate.challenge-terms.v1\ncreator=${terms.creator}\nopponent=${terms.opponent}\nstakeMist=123456789\nfixture=Demo FC vs Example United\nmarket=Home win\nfundingDeadlineMs=1700000000000\noutcomeDeadlineMs=1700003600000\noutcomeAuthority=${terms.outcomeAuthority}\n`);
  assert.equal(await hashCanonicalChallengeTerms(terms), "0xd11c78d1f6467a42be7884fe79e9ecca909b34ecb6166daec21be3e01d948de2");
});

test("canonical terms reject ambiguous or invalid values", () => {
  assert.throws(() => canonicalizeChallengeTerms({ ...terms, fixture: "demo\nfixture" }));
  assert.throws(() => canonicalizeChallengeTerms({ ...terms, stakeMist: BigInt(0) }));
  assert.throws(() => canonicalizeChallengeTerms({ ...terms, fundingDeadlineMs: terms.outcomeDeadlineMs }));
});
