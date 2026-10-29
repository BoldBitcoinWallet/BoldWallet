// F20 cross-platform digest vector — paste-ready check, run with:
//   swiftc -O PsbtDigest.swift f20_digest_check.swift -o /tmp/f20check && /tmp/f20check
// (PsbtDigest.swift is the app source, included unchanged.)
// Expected digest asserted in Go TestF20 and Kotlin F20PsbtBindingTest.
import Foundation

let expected = "417228a47b1ef375d6726a1e920ba20a24b577f463ccc78f5b51aadf2b068579"
assert(PsbtDigest.compute("cHNidP8A") == expected, "vector mismatch")
assert(PsbtDigest.compute("cHN idP8A\n") == expected, "whitespace variant mismatch")
assert(PsbtDigest.compute("") == nil, "empty must fail")
assert(PsbtDigest.compute("not-base64!!!") == nil, "garbage must fail")
assert(PsbtDigest.compute("aGVsbG8=") == nil, "no-magic must fail")
print("F20 Swift digest parity: PASS")
