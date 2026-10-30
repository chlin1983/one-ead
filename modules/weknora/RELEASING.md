# WeKnora prebuilt binary — release process

The downloader (`scripts/download_binary.py`) **fails closed**: it installs a prebuilt binary only if
its SHA-256 matches a digest pinned in `release_manifest.json`. Do not bypass this.

## Publishing and pinning a release

1. Run the **Build WeKnora Lite Prebuilt Binary** workflow (`workflow_dispatch` with a `release_tag`, or push
   a `weknora-*` / `v*` tag). It builds from the pinned upstream revision, publishes the assets plus
   `SHA256SUMS.txt`, and creates a build-provenance attestation.
2. On a trusted machine with the `gh` CLI signed in, run:

   ```
   python modules/weknora/scripts/update_release_manifest.py --tag <tag> --require-attestation
   ```

   The tool downloads each asset from the approved release path only, computes SHA-256 **locally**,
   cross-checks `SHA256SUMS.txt`, verifies the attestation with `gh attestation verify`, and rewrites
   `release_manifest.json`. Any mismatch aborts without writing.
3. Open a pull request with the manifest change. A reviewer confirms the tag, the digests and the
   workflow run that produced them before merging.

`SHA256SUMS.txt` lives on the same release as the assets, so on its own it is not independent proof;
the attestation check and PR review are what establish trust. Never auto-commit the manifest from CI.

You can also supply a digest out-of-band for one-off installs with `WEKNORA_RELEASE_SHA256`.

## Using your own local build

`build_info.json` is plain metadata and is **never** treated as proof of integrity. A binary built from source
(`build_lite.bat`) is therefore rejected by default. To use it, make an explicit decision for that exact file:

```
# compute the hash of the file you built, then accept exactly that hash
Get-FileHash modules/weknora/WeKnora-lite.exe -Algorithm SHA256
$env:WEKNORA_ACCEPT_LOCAL_BUILD_SHA256 = "<sha256>"      # or --accept-local-build-sha256 <sha256>
```

The result is labelled **UNVERIFIED**; if the file changes, the accepted digest no longer matches and it is rejected.
