# Docker Build System

This directory contains all Docker-related files and scripts for building the BoldWallet Android APK.

## Structure

```
docker/
├── README.md                    # This file
└── scripts/
    ├── docker-apk-builder.sh   # Main build script
    ├── extract-apk.sh          # Extract APK from built image
    ├── docker-cleanup.sh       # Clean up old images/containers
    └── docker-disk-usage.sh    # Show disk usage statistics
```

## Quick Start

### Build APK

```bash
# From project root
./docker/scripts/docker-apk-builder.sh

# With verbose output
./docker/scripts/docker-apk-builder.sh --verbose

# F-Droid build
./docker/scripts/docker-apk-builder.sh --fdroid

# Build from specific git reference
./docker/scripts/docker-apk-builder.sh --git=main --verbose
```

### Extract APK from Existing Image

```bash
./docker/scripts/extract-apk.sh
```

### Check Disk Usage

```bash
./docker/scripts/docker-disk-usage.sh
```

### Clean Up Old Builds

```bash
# Clean old images/containers (keeps latest)
./docker/scripts/docker-cleanup.sh

# Clean everything including build cache
./docker/scripts/docker-cleanup.sh --all

# Preview what would be removed
./docker/scripts/docker-cleanup.sh --dry-run
```

## Scripts

### docker-apk-builder.sh

Main script to build the Docker image and extract the APK.

**Options:**
- `--fdroid` - Build F-Droid compatible version
- `--git=REF` - Build from specific git reference (commit, tag, branch)
- `--verbose, -v` - Show build logs on CLI
- `--help, -h` - Show help message

**Output:**
- `app-release.apk` - Built APK file
- `mapping.txt` - R8/ProGuard mapping file (if enabled)
- `build.log` - Build logs

### extract-apk.sh

Extract APK from an already-built Docker image (useful if build was done on another machine).

**Usage:**
```bash
./docker/scripts/extract-apk.sh
```

### docker-cleanup.sh

Clean up old Docker images, containers, and build cache.

**Options:**
- `--dry-run` - Preview what would be removed
- `--no-images` - Don't remove images
- `--no-containers` - Don't remove containers
- `--build-cache` - Also clean build cache
- `--all` - Clean everything (including build cache, doesn't keep latest)
- `--help, -h` - Show help

### docker-disk-usage.sh

Show detailed disk usage for Docker images, containers, and build cache.

**Usage:**
```bash
./docker/scripts/docker-disk-usage.sh
```

## Dockerfile Location

The `Dockerfile` and `.dockerignore` remain in the project root because:
- Docker build context must be the project root
- They need to access project files (package.json, BBMTLib, etc.)

## Build Optimizations

The Docker build system includes several optimizations:

1. **Layer Caching** - Dependencies are cached separately from code
2. **BuildKit Cache Mounts** - npm, Go modules, Android SDK, and Gradle caches persist across builds
3. **Multi-stage Build** - Optimized layer structure
4. **.dockerignore** - Excludes unnecessary files from build context

See the build logs or run with `--verbose` to see cache usage.

## Performance

- **First build**: ~30-60 minutes (downloads all dependencies)
- **Subsequent builds** (code changes only): ~5-10 minutes (uses cached dependencies)
- **Dependency updates**: ~15-20 minutes (only new dependencies downloaded)

## Troubleshooting

### Build fails
- Check `build.log` for errors
- Run with `--verbose` to see real-time output
- Ensure Docker BuildKit is enabled: `export DOCKER_BUILDKIT=1`

### Out of disk space
- Run `./docker/scripts/docker-disk-usage.sh` to check usage
- Run `./docker/scripts/docker-cleanup.sh` to clean old builds
- Clean build cache: `./docker/scripts/docker-cleanup.sh --build-cache`

### APK extraction fails
- Ensure the Docker image exists: `docker images | grep boldwallet-apk-exporter`
- Check container exists: `docker ps -a | grep temp-boldwallet`
- Run `./docker/scripts/extract-apk.sh` for diagnostics

## Requirements

- Docker 18.09+ (with BuildKit support)
- Linux (tested on Ubuntu)
- Sufficient disk space (~20GB for build cache, ~15GB per image)

## Notes

- All scripts automatically detect the project root
- Scripts can be run from any directory
- Output files (APK, mapping.txt) are placed in project root
- Build logs are saved to `build.log` in project root
