import re
import uuid
from typing import List, Tuple
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_active_user, get_org_context, require_role
from app.core.database import get_db
from app.models.membership import OrganizationMember, OrganizationRole
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import (
    OrganizationCreateRequest,
    OrganizationMemberAddRequest,
    OrganizationMemberResponse,
    OrganizationResponse,
)

router = APIRouter(prefix="/organizations", tags=["Organizations"])


def generate_slug_base(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower()
    if not slug:
        slug = f"org-{uuid.uuid4().hex[:8]}"
    return slug[:50]


async def get_unique_slug(db: AsyncSession, base_slug: str) -> str:
    slug = base_slug
    counter = 1
    while True:
        query = select(Organization.id).where(Organization.slug == slug)
        res = await db.execute(query)
        if res.scalar_one_or_none() is None:
            return slug
        slug = f"{base_slug[:45]}-{counter}"
        counter += 1


@router.post(
    "",
    response_model=OrganizationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new organization",
)
async def create_organization(
    req: OrganizationCreateRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a new organization and assigns current_user as OWNER.
    Executes in a single database transaction.
    """
    base_slug = req.slug if req.slug else generate_slug_base(req.name)
    slug = await get_unique_slug(db, base_slug)

    new_org = Organization(
        name=req.name.strip(),
        slug=slug,
    )
    db.add(new_org)
    await db.flush()

    membership = OrganizationMember(
        organization_id=new_org.id,
        user_id=current_user.id,
        role=OrganizationRole.OWNER.value,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(new_org)

    return OrganizationResponse(
        id=new_org.id,
        name=new_org.name,
        slug=new_org.slug,
        created_at=new_org.created_at,
        role=OrganizationRole.OWNER.value,
        member_count=1,
    )


@router.get(
    "",
    response_model=List[OrganizationResponse],
    summary="List organizations for the current user",
)
async def list_organizations(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists all organizations where current_user holds an active membership.
    Multi-tenant isolation guarantee: only returns user's tenant memberships.
    """
    stmt = (
        select(Organization, OrganizationMember.role)
        .join(OrganizationMember, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == current_user.id)
        .order_by(Organization.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    orgs = []
    for org, role in rows:
        # Get member count for organization
        cnt_stmt = select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == org.id
        )
        count = await db.scalar(cnt_stmt) or 1

        orgs.append(
            OrganizationResponse(
                id=org.id,
                name=org.name,
                slug=org.slug,
                created_at=org.created_at,
                role=role,
                member_count=count,
            )
        )
    return orgs


@router.get(
    "/{organization_id}",
    response_model=OrganizationResponse,
    summary="Get organization details",
)
async def get_organization(
    org_context: Tuple[Organization, OrganizationMember] = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns organization details for an active tenant member.
    Enforces multi-tenant isolation: non-members receive 404 Not Found.
    """
    org, member = org_context
    cnt_stmt = select(func.count(OrganizationMember.id)).where(
        OrganizationMember.organization_id == org.id
    )
    count = await db.scalar(cnt_stmt) or 1

    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        created_at=org.created_at,
        role=member.role,
        member_count=count,
    )


@router.post(
    "/{organization_id}/members",
    response_model=OrganizationMemberResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a member to an organization",
)
async def add_organization_member(
    organization_id: uuid.UUID,
    req: OrganizationMemberAddRequest,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Adds a new member to the organization with a specified role.
    Only OWNER and ADMIN roles may perform this action.
    Admins cannot grant OWNER privileges.
    """
    org, caller_member = org_context

    # Restrict ADMIN from granting OWNER role
    if caller_member.role == OrganizationRole.ADMIN.value and req.role == OrganizationRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admins cannot grant owner privileges",
        )

    # Find target user by email
    email_clean = req.email.strip().lower()
    user_stmt = select(User).where(User.email == email_clean)
    target_user = await db.scalar(user_stmt)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found with the provided email",
        )

    # Check for duplicate membership
    dup_stmt = select(OrganizationMember).where(
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.user_id == target_user.id,
    )
    existing_member = await db.scalar(dup_stmt)
    if existing_member:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this organization",
        )

    # Create membership
    new_member = OrganizationMember(
        organization_id=organization_id,
        user_id=target_user.id,
        role=req.role.value,
    )
    db.add(new_member)
    await db.commit()
    await db.refresh(new_member)

    return OrganizationMemberResponse(
        id=new_member.id,
        user_id=target_user.id,
        email=target_user.email,
        full_name=target_user.full_name,
        role=new_member.role,
        created_at=new_member.created_at,
    )


@router.delete(
    "/{organization_id}/members/{user_id}",
    summary="Remove a member from an organization",
)
async def remove_organization_member(
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    org_context: Tuple[Organization, OrganizationMember] = Depends(
        require_role([OrganizationRole.OWNER, OrganizationRole.ADMIN])
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Removes a member from the organization.
    Enforces rules:
    - Caller must be OWNER or ADMIN.
    - ADMIN cannot remove an OWNER.
    - The last OWNER cannot be removed.
    """
    org, caller_member = org_context

    # Find target membership
    stmt = select(OrganizationMember).where(
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.user_id == user_id,
    )
    target_member = await db.scalar(stmt)
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found in organization",
        )

    # Rule: ADMIN cannot remove an OWNER
    if (
        caller_member.role == OrganizationRole.ADMIN.value
        and target_member.role == OrganizationRole.OWNER.value
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admins cannot remove an organization owner",
        )

    # Rule: The last OWNER cannot be removed
    if target_member.role == OrganizationRole.OWNER.value:
        owner_cnt_stmt = select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.role == OrganizationRole.OWNER.value,
        )
        owner_count = await db.scalar(owner_cnt_stmt) or 0
        if owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the only owner of the organization",
            )

    await db.delete(target_member)
    await db.commit()

    return {"message": "Member removed successfully"}
