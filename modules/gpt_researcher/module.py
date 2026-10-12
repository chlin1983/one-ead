"""GPT Researcher — offline-first engineering research assistant plugin for One EAD.

Wraps gpt-researcher with a local Ollama model. See README.md for the privacy model.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from modules.gpt_researcher import researcher
from server.module import PortalModule

ICON = (
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'
    '<rect x="8" y="9" width="6" height="5" rx="1"/><path d="M9.5 9V8a1.5 1.5 0 0 1 3 0v1"/>'
    '</svg>'
)

router = APIRouter()


@router.get("/status")
def status() -> dict:
    return researcher.status()


@router.post("/engine/install")
def install_engine() -> dict:
    return researcher.start_install()


@router.post("/engine/update/check")
def check_engine_update() -> dict:
    researcher.check_update()
    return researcher.status()


@router.post("/engine/update")
def update_engine() -> dict:
    try:
        return researcher.start_update()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/engine/update/settings")
def update_settings(payload: dict = Body(...)) -> dict:
    return researcher.set_auto_update(payload.get("auto_update") is True)


@router.post("/engine/rollback")
def rollback_engine() -> dict:
    try:
        return researcher.rollback_engine()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except OSError as exc:
        raise HTTPException(500, f"Could not switch engines: {exc}")


@router.post("/models/pull")
def pull_model(payload: dict = Body(...)) -> dict:
    try:
        return researcher.start_pull(str(payload.get("model") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/docs")
async def upload_doc(file: UploadFile = File(...)) -> dict:
    try:
        researcher.save_doc(file.filename or "", file.file)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return researcher.status()


@router.delete("/docs/{name}")
def delete_doc(name: str) -> dict:
    if not researcher.delete_doc(name):
        raise HTTPException(404, "Document not found")
    return researcher.status()


@router.post("/research")
def start_research(payload: dict = Body(...)) -> dict:
    try:
        return researcher.start_research(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@router.post("/research/cancel")
def cancel_research() -> dict:
    return researcher.cancel_research()


@router.get("/reports")
def list_reports() -> list:
    return researcher.list_reports()


@router.get("/reports/{report_id}")
def get_report(report_id: str) -> dict:
    found = researcher.get_report(report_id)
    if found is None:
        raise HTTPException(404, "Report not found")
    return found


@router.get("/reports/{report_id}/download")
def download_report(report_id: str, format: str = "md") -> FileResponse:
    if format not in ("md", "pdf"):
        raise HTTPException(400, "format must be md or pdf")
    if format == "pdf":
        try:
            path = researcher.report_pdf(report_id)
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))
        media = "application/pdf"
    else:
        path, media = researcher.report_file(report_id), "text/markdown"
    if path is None:
        raise HTTPException(404, "Report not found")
    return FileResponse(path, media_type=media, filename=f"research-{report_id}.{format}")


@router.delete("/reports/{report_id}")
def delete_report(report_id: str) -> dict:
    if not researcher.delete_report(report_id):
        raise HTTPException(404, "Report not found or still running")
    return {"ok": True}


@router.patch("/reports/{report_id}")
def update_report(report_id: str, payload: dict = Body(...)) -> dict:
    try:
        found = researcher.update_report(report_id, {k: payload[k] for k in ("title", "folder") if k in payload})
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if found is None:
        raise HTTPException(404, "Report not found")
    return found


@router.get("/folders")
def list_folders() -> list:
    return researcher.list_folders()


@router.post("/folders")
def create_folder(payload: dict = Body(...)) -> dict:
    return {"folder": researcher.create_folder(str(payload.get("name") or ""))}


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: str, payload: dict = Body(...)) -> dict:
    try:
        found = researcher.rename_folder(folder_id, str(payload.get("name") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if found is None:
        raise HTTPException(404, "Folder not found")
    return {"folder": found}


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict:
    if not researcher.delete_folder(folder_id):
        raise HTTPException(404, "Folder not found")
    return {"ok": True}


MODULE = PortalModule(
    id="gpt-researcher",
    title="GPT Researcher",
    subtitle="Offline engineering research (local AI)",
    icon=ICON,
    accent="#1f7a8c",
    order=89,
    web_dir="web",
    router=router,
)
