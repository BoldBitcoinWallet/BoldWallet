# Fastlane Setup for Bold Bitcoin Wallet

This directory contains the Fastlane configuration for the Bold Bitcoin Wallet Android app.

## Available Lanes

- `fastlane android test`: Run Android tests
- `fastlane android fdroid`: Build a release version for F-Droid
- `fastlane android metadata`: Generate metadata for F-Droid

## Metadata

The app metadata is stored in the `metadata/android` directory, with localized versions in language-specific subdirectories.

### Adding Screenshots

Place your screenshots in the `metadata/android/en-US/images/phoneScreenshots` directory.

### Updating Descriptions

Edit the following files to update app descriptions:
- `metadata/android/en-US/full_description.txt`
- `metadata/android/en-US/short_description.txt`
- `metadata/android/en-US/title.txt`

## Usage

To use Fastlane, run the following command from the `android` directory:

```
bundle exec fastlane [lane]
```

Example:
```
bundle exec fastlane android fdroid
``` 