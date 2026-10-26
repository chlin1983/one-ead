# User Preferences & Execution Guidelines

## Testing & Verification Workflow
- **No Browser / DOM Extraction**: Do not run browser subagent sessions, DOM extraction, or UI testing.
- **Focus on Direct Code Changes**: Focus directly on analyzing the problem, implementing the bug fixes, and modifying the code cleanly.
- **User-Led Testing**: The user will test the application changes themselves in the browser.

## Data Privacy & Confidential Document Storage
- **External Document Vault**: All confidential user documents, PDFs, OCR texts, and archives are strictly kept outside the git workspace (e.g. `~/Documents/OneEAD_Archive`).
- **No Document Vault Inspection**: Agents must NEVER read, search, list, or ingest user files from `OneEAD_Archive` or user document data directories.
- **Development With Synthetic Fixtures Only**: Only synthetic, unclassified test fixtures inside temporary scratch/test scripts may be used during development.

