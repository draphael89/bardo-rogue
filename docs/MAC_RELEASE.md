# Bardo Rogue macOS release

This is the direct-download Apple Silicon release path. It produces one Developer ID-signed,
notarized game for macOS while the browser remains the primary development surface.

## One-time setup

1. Install the `Developer ID Application: Infinity Growth Digital, Inc. (YF9662K2Y4)` certificate
   and its private key in the login Keychain.
2. Confirm that macOS can use it:

   ```sh
   security find-identity -v -p codesigning
   ```

3. Generate an app-specific password at <https://appleid.apple.com/>.
4. Store the notarization credentials directly in Keychain. Do not put the password in a shell
   command, repository file, chat message, or environment file. Omitting `--password` makes
   `notarytool` prompt for it securely:

   ```sh
   xcrun notarytool store-credentials "bardo-notary" \
     --apple-id "draphael@uchicago.edu" \
     --team-id "YF9662K2Y4"
   ```

## Validate before packaging

Run the normal browser and Electron gates first:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm smoke:desktop
```

## Exercise local signing

This path signs with the Developer ID certificate but does not contact Apple:

```sh
corepack pnpm desktop:dist:signed-local
corepack pnpm desktop:verify
```

Open `release/mac-arm64/Bardo Rogue.app` and check launch, game input, audio, fullscreen, and save
reload on the release hardware. A signed-but-unnotarized local build is not a distributable release.

## Build the distributable release

The Keychain profile activates electron-builder's notarization step. The build signs the app,
uploads it to Apple, waits for acceptance, and staples the returned ticket before creating the dmg
and zip:

```sh
APPLE_KEYCHAIN_PROFILE=bardo-notary corepack pnpm desktop:dist
corepack pnpm desktop:verify:notarized
```

The verifier requires the Infinity Growth Digital team signature, Hardened Runtime, the minimum V8
entitlements, the Bardo icon, an arm64 executable, valid dmg and zip archives, Gatekeeper acceptance,
and a stapled notarization ticket. It writes `release/SHA256SUMS.txt` for the two distributable files.

## Clean-machine check

Before sharing a release, test it as a player receives it:

1. Copy the dmg to another Apple Silicon Mac or download it through a browser.
2. Open the dmg and drag Bardo Rogue to Applications.
3. Launch it normally without Control-clicking, bypassing Gatekeeper, or changing security settings.
4. Verify input, audio, fullscreen, a new save, quit, relaunch, and save restoration.
5. Compare the downloaded dmg checksum with `SHA256SUMS.txt`.

## Scope and safety

- The dmg is the tester-friendly installer; the zip is retained for future Steam or updater work.
- The dmg container itself remains unsigned, as electron-builder recommends for notarized releases.
  The signed, notarized, stapled app inside both archives is what Gatekeeper assesses; the verifier
  mounts or extracts each archive and checks that embedded app independently.
- Releases are manual for now. There is no auto-updater or publishing token in the repository.
- Do not sign this direct-download build with an Apple Development or Mac App Store certificate.
- Do not commit Apple passwords, API keys, exported certificates, or private keys.
- Do not treat a successful build as release proof: the notarized verifier and clean-machine check are
  separate gates.
