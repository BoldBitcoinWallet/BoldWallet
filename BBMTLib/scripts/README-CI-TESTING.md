# Testing CI Pipeline Locally

This guide explains how to test the CI/CD pipeline locally without pushing to GitHub.

## Option 1: Local Test Script (Recommended)

The easiest way is to use the provided local test script that mimics the GitHub Actions workflow:

```bash
cd BBMTLib
./scripts/test-ci-local.sh
```

This script runs all the same steps as the CI pipeline:
- Go version verification
- Dependency management
- Building packages
- Running tests
- Code formatting checks
- Comprehensive script tests

### What it does:
- Runs all CI steps in sequence
- Shows colored output for pass/fail
- Stops on errors (but continues for non-critical steps)
- Provides a summary at the end

### Requirements:
- Go installed (same version as CI: 1.24.2)
- Docker (for local relay tests)
- `jq` (will try to install automatically if missing)

## Option 2: Using `act` (GitHub Actions Runner)

For a more accurate simulation of GitHub Actions, you can use [`act`](https://github.com/nektos/act):

### Installation

**macOS:**
```bash
brew install act
```

**Linux:**
```bash
# Using the install script
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

**Or download from releases:**
https://github.com/nektos/act/releases

### Usage

Run the entire workflow:
```bash
cd /path/to/BoldWallet-Fork
act -W .github/workflows/bbmtlib-test.yml
```

Run a specific job:
```bash
# Run the test job
act -j test -W .github/workflows/bbmtlib-test.yml

# Run the integration-test job
act -j integration-test -W .github/workflows/bbmtlib-test.yml
```

### First-time setup

On first run, `act` will ask you to select a Docker image. Choose:
- `ubuntu-latest` (recommended, matches CI)

### Limitations

- `act` runs in Docker containers, so it's slower than the local script
- Some GitHub Actions features may not work exactly the same
- Docker-in-Docker may require special configuration

### Advanced usage

Run with specific event:
```bash
act push -W .github/workflows/bbmtlib-test.yml
```

Run with environment variables:
```bash
act -e .github/workflows/bbmtlib-test.yml --env RELAYS="ws://localhost:7777"
```

## Option 3: Manual Step-by-Step

You can also run the CI steps manually:

```bash
cd BBMTLib

# 1. Verify Go version
go version

# 2. Install dependencies
go mod download
go mod verify
go mod tidy

# 3. Check for uncommitted changes
git status

# 4. Run tests
go test -v -race -coverprofile=coverage.out ./...

# 5. Build packages
go build ./...
go build -o /tmp/bbmtlib-scripts ./scripts/main.go

# 6. Test scripts
./scripts/test-all.sh

# 7. Run vet and formatting checks
go vet ./...
gofmt -s -l .
```

## Quick Test Commands

### Test just the scripts:
```bash
cd BBMTLib
./scripts/test-all.sh
```

### Test Go code:
```bash
cd BBMTLib
go test -v ./...
go build ./...
go vet ./...
```

### Check formatting:
```bash
cd BBMTLib
gofmt -s -l .
# If there are changes, format with:
gofmt -s -w .
```

## Troubleshooting

### Docker not available
If Docker is not available, the test script will fall back to external relays. Tests may be flaky but will still run.

### Go version mismatch
Make sure you're using Go 1.24.2 (or compatible version):
```bash
go version
# Should show: go version go1.24.2 ...
```

### Missing dependencies
Install missing tools:
```bash
# jq (JSON processor)
sudo apt-get install jq  # Debian/Ubuntu
brew install jq          # macOS

# staticcheck (optional)
go install honnef.co/go/tools/cmd/staticcheck@latest
```

## CI vs Local Differences

| Feature | CI | Local Script | act |
|---------|----|--------------|-----|
| Speed | Medium | Fast | Slow |
| Accuracy | 100% | ~95% | ~98% |
| Docker required | No | Yes (for relay) | Yes |
| Setup complexity | None | Low | Medium |

**Recommendation:** Use the local test script (`test-ci-local.sh`) for quick feedback, and use `act` when you need to verify exact CI behavior.

