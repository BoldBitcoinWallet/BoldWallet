# Scripts Testing Pipeline

This document describes the testing pipeline for all scripts in the `BBMTLib/scripts/` directory.

## Overview

The testing pipeline ensures that each script in the `scripts/` folder runs correctly and produces valid outputs. The main test script is `test-all.sh`, which:

1. Tests all helper commands in `main.go`
2. Validates script syntax
3. Runs each script and verifies outputs
4. Checks that generated files (keyshares, signatures) are valid JSON with required fields
5. Verifies that outputs from different parties match when expected

## Running Tests

### Local Testing

To run the test suite locally:

```bash
cd BBMTLib
./scripts/test-all.sh
```

The script will:
- Test all scripts sequentially
- Show colored output (green for pass, red for fail, yellow for skip)
- Generate test output directories for inspection
- Provide a summary at the end

### CI/CD Testing

The test script is automatically run in GitHub Actions as part of the CI pipeline:

- **Basic tests**: Run in the main `test` job (syntax checks, helper commands)
- **Integration tests**: Run in the `integration-test` job (full script execution with external relays)

The integration tests may be skipped or fail due to external relay connectivity issues, but this is expected and non-blocking.

## Test Coverage

### Scripts Tested

1. **main.go helper commands**
   - `random`: Generates random hex strings
   - `nostr-keypair`: Generates Nostr keypairs

2. **keygen.sh**
   - Syntax validation
   - Binary build verification
   - Uses local relay server

3. **keysign.sh**
   - Syntax validation
   - Requires keyshare files from keygen
   - Uses local relay server

4. **nostr-keygen.sh**
   - Syntax validation
   - Full execution (requires external Nostr relays)
   - Validates output keyshare JSON files
   - Verifies matching public keys between parties

5. **nostr-keysign.sh**
   - Syntax validation
   - Full execution (requires nostr-keygen output and external relays)
   - Validates output signature JSON files
   - Verifies matching signatures between parties

6. **nostr-keygen-3party.sh**
   - Syntax validation
   - Full execution (requires external Nostr relays)
   - Validates output keyshare JSON files for all 3 parties
   - Verifies matching public keys across all parties

## Output Validation

### Keyshare Files

Keyshare files (`.json`) are validated to ensure they:
- Exist and are not empty
- Contain valid JSON
- Include required fields:
  - `pub_key`: Public key string
  - `chain_code_hex`: Chain code in hex format

### Signature Files

Signature files (`.json`) are validated to ensure they:
- Exist and are not empty
- Contain valid JSON
- Include required fields:
  - `r`: Signature r component
  - `s`: Signature s component

### Cross-Party Validation

For multi-party scripts:
- All parties must produce keyshares with matching `pub_key` values
- All parties must produce signatures with matching `r` and `s` values

## Test Output Directories

The test script creates temporary output directories:

- `./test-nostr-keygen-output/`: Output from nostr-keygen.sh tests
- `./test-nostr-keysign-output/`: Output from nostr-keysign.sh tests
- `./test-nostr-keygen-3party-output/`: Output from nostr-keygen-3party.sh tests

These directories are preserved after tests for inspection. Log files are also created for debugging.

## Environment Variables

The test script respects the following environment variables:

- `RELAYS`: Comma-separated list of Nostr relay URLs (default: production relays)
- `TIMEOUT`: Timeout in seconds for script execution (default: 30 for tests, 90 for production)
- `OUTPUT_DIR`: Directory for keygen output (default: `./nostr-keygen-output`)
- `KEYSIGN_OUTPUT_DIR`: Directory for keysign output (default: `./nostr-keysign-output`)

## Troubleshooting

### Tests Fail Due to Relay Connectivity

If tests fail with timeout or connection errors, this is expected when:
- External Nostr relays are unreachable
- Network connectivity is poor
- Relays are experiencing high load

The test script marks these as "skipped" rather than "failed" to distinguish between actual script errors and connectivity issues.

### Missing Dependencies

Ensure you have:
- `bash` (version 4.0+)
- `go` (version 1.24.2+)
- `jq` (optional, for JSON validation - installed automatically in CI)

### Script Syntax Errors

If a script has syntax errors, the test will fail immediately. Check the script with:
```bash
bash -n scripts/<script-name>.sh
```

## Adding New Scripts

When adding a new script to the `scripts/` directory:

1. Add a test section in `test-all.sh`
2. Ensure the script is executable (`chmod +x`)
3. Add validation logic for expected outputs
4. Update this documentation

## CI Integration

The test script is integrated into the GitHub Actions workflow (`.github/workflows/bbmtlib-test.yml`):

- Runs in the `test` job for basic validation
- Runs in the `integration-test` job for full execution
- Uses `continue-on-error: true` for integration tests to handle flaky relay connectivity
- Timeout set to 15 minutes for integration tests

