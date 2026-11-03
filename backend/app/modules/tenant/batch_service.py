from sqlalchemy import literal, select, union_all

from app.modules.dispatch.models import ReviewRound
from app.modules.result.objection_models import Objection
from app.modules.result.objection_service import OPEN_STATUSES
from app.modules.review.models import ReviewCorrectionRequest
from app.modules.tenant.service import get_batch
from app.modules.thesis.models import Thesis, ThesisVersion
from app.shared.enums import ThesisStage


async def closeout(session, tenant_id, batch_id):
    await get_batch(session, tenant_id, batch_id)
    def items(kind, object_id, status):
        return (select(literal(kind).label("kind"), object_id.label("id"),
                       Thesis.id.label("thesis_id"), ThesisVersion.title.label("title"), status.label("status"))
                .select_from(Thesis).outerjoin(ThesisVersion, ThesisVersion.id == Thesis.current_version_id)
                .where(Thesis.review_batch_id == batch_id, Thesis.tenant_id == tenant_id))

    work = union_all(
        items("unpublished", Thesis.id, Thesis.stage).where(
            Thesis.stage.not_in([ThesisStage.COMPLETED, ThesisStage.TERMINATED])),
        items("objections", Objection.id, Objection.status).join(Objection, Objection.thesis_id == Thesis.id)
        .where(Objection.status.in_(OPEN_STATUSES)),
        items("corrections", ReviewCorrectionRequest.id, ReviewCorrectionRequest.status)
        .join(ReviewRound, ReviewRound.thesis_id == Thesis.id)
        .join(ReviewCorrectionRequest, ReviewCorrectionRequest.round_id == ReviewRound.id)
        .where(ReviewCorrectionRequest.status == "AWAITING_SCHOOL"),
    ).subquery()
    groups = {"unpublished": [], "objections": [], "corrections": []}
    for row in (await session.execute(select(work).order_by(work.c.title, work.c.id))).mappings():
        groups[row["kind"]].append({"id": str(row["id"]), "thesis_id": str(row["thesis_id"]),
                                    "title": row["title"], "status": row["status"]})
    return groups
