import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.analytics import (
    AnalyticsOverviewResponse,
    DurationMetrics,
    ExecutionVolumeMetrics,
    SLAMetrics,
    SLAMonitoringItem,
    SLAMonitoringResponse,
    StepLatencyItem,
    StepLatencyResponse,
    TimeSeriesBucket,
    TimeSeriesResponse,
    WorkflowPerformanceItem,
    WorkflowPerformanceResponse,
)


def parse_and_validate_time_range(
    time_range: Optional[str] = "24h",
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> Tuple[datetime, datetime, str, str]:
    """
    Validates and normalizes time ranges to half-open UTC intervals [start_time, end_time).
    Enforces maximum range of 90 days.
    Determines appropriate time-series granularity:
    - <= 48 hours: hourly
    - > 48 hours and <= 60 days: daily
    - > 60 days and <= 90 days: weekly
    """
    now = datetime.now(timezone.utc)

    if start_time is not None and end_time is not None:
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        else:
            start_time = start_time.astimezone(timezone.utc)

        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)
        else:
            end_time = end_time.astimezone(timezone.utc)

        if start_time >= end_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_time must be strictly before end_time",
            )

        range_delta = end_time - start_time
        if range_delta > timedelta(days=90):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Custom date range cannot exceed 90 days",
            )
        resolved_range = "custom"
    else:
        resolved_range = time_range or "24h"
        end_time = now

        if resolved_range == "24h":
            start_time = now - timedelta(hours=24)
        elif resolved_range == "7d":
            start_time = now - timedelta(days=7)
        elif resolved_range == "30d":
            start_time = now - timedelta(days=30)
        elif resolved_range == "90d":
            start_time = now - timedelta(days=90)
        elif resolved_range == "custom":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="start_time and end_time are required when range is 'custom'",
            )
        else:
            resolved_range = "24h"
            start_time = now - timedelta(hours=24)

    delta = end_time - start_time
    if delta <= timedelta(hours=48):
        granularity = "hourly"
    elif delta <= timedelta(days=60):
        granularity = "daily"
    else:
        granularity = "weekly"

    return start_time, end_time, resolved_range, granularity


class AnalyticsService:
    """
    Production-grade query-side analytics aggregation engine.
    Executes single-pass database-level aggregations in PostgreSQL with ZERO migrations.
    """

    @staticmethod
    async def get_overview(
        db: AsyncSession,
        organization_id: uuid.UUID,
        workflow_id: Optional[uuid.UUID] = None,
        time_range: Optional[str] = "24h",
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> AnalyticsOverviewResponse:
        """
        Calculates executive KPI metrics: volume, latency percentiles, and SLA compliance.
        """
        start_dt, end_dt, resolved_range, _ = parse_and_validate_time_range(
            time_range=time_range,
            start_time=start_time,
            end_time=end_time,
        )

        params: Dict[str, Any] = {
            "org_id": organization_id,
            "start_dt": start_dt,
            "end_dt": end_dt,
        }
        wf_clause_r = ""
        if workflow_id is not None:
            wf_clause_r = "AND r.workflow_id = :wf_id"
            params["wf_id"] = workflow_id

        # 1. Volume & Duration Aggregation
        vol_duration_query = text(f"""
            SELECT
                COUNT(*) FILTER (WHERE r.status IN ('SUCCESS', 'COMPLETED')) AS success_count,
                COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed_count,
                COUNT(*) FILTER (WHERE r.status = 'CANCELLED') AS cancelled_count,
                COUNT(*) FILTER (WHERE r.status = 'RUNNING') AS running_count,
                COUNT(*) FILTER (WHERE r.status = 'PENDING') AS pending_count,
                COUNT(*) FILTER (WHERE r.status IN ('WAITING_APPROVAL', 'PAUSED')) AS waiting_approval_count,
                COALESCE(AVG(
                    CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS avg_duration_ms,
                COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (
                    ORDER BY CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS p50_duration_ms,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS p95_duration_ms,
                COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (
                    ORDER BY CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS p99_duration_ms
            FROM workflow_runs r
            WHERE r.organization_id = :org_id
              AND r.started_at >= :start_dt
              AND r.started_at < :end_dt
              {wf_clause_r}
        """)

        vol_res = await db.execute(vol_duration_query, params)
        row = vol_res.fetchone()

        s_count = int(row.success_count or 0)
        f_count = int(row.failed_count or 0)
        c_count = int(row.cancelled_count or 0)
        r_count = int(row.running_count or 0)
        p_count = int(row.pending_count or 0)
        w_count = int(row.waiting_approval_count or 0)

        total_runs = s_count + f_count + c_count + r_count + p_count + w_count
        terminal_runs = s_count + f_count + c_count
        in_flight_runs = r_count + p_count + w_count

        success_rate = round((s_count / terminal_runs * 100.0), 2) if terminal_runs > 0 else 0.0
        failure_rate = round((f_count / terminal_runs * 100.0), 2) if terminal_runs > 0 else 0.0
        cancellation_rate = round((c_count / terminal_runs * 100.0), 2) if terminal_runs > 0 else 0.0

        volume_metrics = ExecutionVolumeMetrics(
            total=total_runs,
            terminal=terminal_runs,
            in_flight=in_flight_runs,
            success_count=s_count,
            failed_count=f_count,
            cancelled_count=c_count,
            running_count=r_count,
            pending_count=p_count,
            waiting_approval_count=w_count,
            success_rate=success_rate,
            failure_rate=failure_rate,
            cancellation_rate=cancellation_rate,
        )

        duration_metrics = DurationMetrics(
            avg_duration_ms=round(float(row.avg_duration_ms or 0.0), 2),
            p50_duration_ms=round(float(row.p50_duration_ms or 0.0), 2),
            p95_duration_ms=round(float(row.p95_duration_ms or 0.0), 2),
            p99_duration_ms=round(float(row.p99_duration_ms or 0.0), 2),
        )

        # 2. Query-Derived SLA Aggregation
        sla_query = text(f"""
            SELECT 
                COUNT(*) FILTER (WHERE sla_status = 'HEALTHY') AS healthy_count,
                COUNT(*) FILTER (WHERE sla_status = 'WARNING') AS warning_count,
                COUNT(*) FILTER (WHERE sla_status = 'BREACHED') AS breached_count,
                COUNT(*) FILTER (WHERE sla_status = 'NOT_APPLICABLE') AS not_applicable_count
            FROM (
                SELECT 
                    CASE
                        WHEN (v.definition->'sla'->>'enabled')::boolean IS NOT TRUE THEN 'NOT_APPLICABLE'
                        WHEN (v.definition->'sla'->>'target_seconds') IS NULL THEN 'NOT_APPLICABLE'
                        WHEN r.status = 'CANCELLED' AND (
                            r.completed_at IS NULL OR 
                            EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) <= (v.definition->'sla'->>'warning_threshold_seconds')::double precision
                        ) THEN 'NOT_APPLICABLE'
                        WHEN (
                            CASE 
                                WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                            END
                        ) > (v.definition->'sla'->>'target_seconds')::double precision THEN 'BREACHED'
                        WHEN (
                            CASE 
                                WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                            END
                        ) > (v.definition->'sla'->>'warning_threshold_seconds')::double precision THEN 'WARNING'
                        ELSE 'HEALTHY'
                    END AS sla_status
                FROM workflow_runs r
                JOIN workflow_versions v ON r.workflow_version_id = v.id
                WHERE r.organization_id = :org_id
                  AND r.started_at >= :start_dt
                  AND r.started_at < :end_dt
                  {wf_clause_r}
            ) evaluated;
        """)

        sla_res = await db.execute(sla_query, params)
        sla_row = sla_res.fetchone()

        h_count = int(sla_row.healthy_count or 0)
        warn_count = int(sla_row.warning_count or 0)
        b_count = int(sla_row.breached_count or 0)
        na_count = int(sla_row.not_applicable_count or 0)

        monitored = h_count + warn_count + b_count
        sla_comp_rate = round(((h_count + warn_count) / monitored * 100.0), 2) if monitored > 0 else 0.0
        sla_healthy_rate = round((h_count / monitored * 100.0), 2) if monitored > 0 else 0.0
        sla_breach_rate = round((b_count / monitored * 100.0), 2) if monitored > 0 else 0.0

        sla_metrics = SLAMetrics(
            monitored_count=monitored,
            healthy_count=h_count,
            warning_count=warn_count,
            breached_count=b_count,
            not_applicable_count=na_count,
            sla_compliance_rate=sla_comp_rate,
            sla_healthy_rate=sla_healthy_rate,
            sla_breach_rate=sla_breach_rate,
        )

        return AnalyticsOverviewResponse(
            organization_id=organization_id,
            workflow_id=workflow_id,
            time_range=resolved_range,
            start_time=start_dt,
            end_time=end_dt,
            volume=volume_metrics,
            duration=duration_metrics,
            sla=sla_metrics,
        )

    @staticmethod
    async def get_time_series(
        db: AsyncSession,
        organization_id: uuid.UUID,
        workflow_id: Optional[uuid.UUID] = None,
        time_range: Optional[str] = "24h",
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        granularity: Optional[str] = None,
    ) -> TimeSeriesResponse:
        """
        Aggregates execution volumes and duration percentiles over continuous zero-filled time buckets.
        """
        start_dt, end_dt, _, auto_granularity = parse_and_validate_time_range(
            time_range=time_range,
            start_time=start_time,
            end_time=end_time,
        )

        effective_granularity = granularity or auto_granularity
        if effective_granularity not in ("hourly", "daily", "weekly"):
            effective_granularity = auto_granularity

        trunc_part = "hour" if effective_granularity == "hourly" else ("day" if effective_granularity == "daily" else "week")

        params: Dict[str, Any] = {
            "org_id": organization_id,
            "start_dt": start_dt,
            "end_dt": end_dt,
        }
        wf_clause_r = ""
        if workflow_id is not None:
            wf_clause_r = "AND r.workflow_id = :wf_id"
            params["wf_id"] = workflow_id

        # Query database buckets
        ts_query = text(f"""
            SELECT
                date_trunc('{trunc_part}', r.started_at) AS bucket_ts,
                COUNT(*) AS total_count,
                COUNT(*) FILTER (WHERE r.status IN ('SUCCESS', 'COMPLETED')) AS success_count,
                COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed_count,
                COUNT(*) FILTER (WHERE r.status = 'CANCELLED') AS cancelled_count,
                COUNT(*) FILTER (WHERE r.status IN ('RUNNING', 'PENDING', 'WAITING_APPROVAL', 'PAUSED')) AS in_flight_count,
                COALESCE(AVG(
                    CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS avg_duration_ms,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY CASE 
                        WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                        THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                    END
                ), 0.0) AS p95_duration_ms
            FROM workflow_runs r
            WHERE r.organization_id = :org_id
              AND r.started_at >= :start_dt
              AND r.started_at < :end_dt
              {wf_clause_r}
            GROUP BY bucket_ts
            ORDER BY bucket_ts ASC
        """)

        res = await db.execute(ts_query, params)
        db_buckets: Dict[datetime, Dict[str, Any]] = {}
        for r in res.fetchall():
            ts = r.bucket_ts
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            db_buckets[ts] = {
                "total_count": int(r.total_count or 0),
                "success_count": int(r.success_count or 0),
                "failed_count": int(r.failed_count or 0),
                "cancelled_count": int(r.cancelled_count or 0),
                "in_flight_count": int(r.in_flight_count or 0),
                "avg_duration_ms": round(float(r.avg_duration_ms or 0.0), 2),
                "p95_duration_ms": round(float(r.p95_duration_ms or 0.0), 2),
            }

        # Generate continuous zero-filled intervals
        buckets: List[TimeSeriesBucket] = []

        if effective_granularity == "hourly":
            step = timedelta(hours=1)
            curr = start_dt.replace(minute=0, second=0, microsecond=0)
        elif effective_granularity == "daily":
            step = timedelta(days=1)
            curr = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        else:  # weekly (aligned to Monday 00:00:00 UTC)
            step = timedelta(weeks=1)
            monday_offset = start_dt.weekday()
            curr = (start_dt - timedelta(days=monday_offset)).replace(hour=0, minute=0, second=0, microsecond=0)

        # Loop until curr exceeds end_dt
        while curr < end_dt:
            data = db_buckets.get(curr, {
                "total_count": 0,
                "success_count": 0,
                "failed_count": 0,
                "cancelled_count": 0,
                "in_flight_count": 0,
                "avg_duration_ms": 0.0,
                "p95_duration_ms": 0.0,
            })
            buckets.append(
                TimeSeriesBucket(
                    timestamp=curr,
                    total_count=data["total_count"],
                    success_count=data["success_count"],
                    failed_count=data["failed_count"],
                    cancelled_count=data["cancelled_count"],
                    in_flight_count=data["in_flight_count"],
                    avg_duration_ms=data["avg_duration_ms"],
                    p95_duration_ms=data["p95_duration_ms"],
                )
            )
            curr += step

        return TimeSeriesResponse(
            organization_id=organization_id,
            workflow_id=workflow_id,
            start_time=start_dt,
            end_time=end_dt,
            granularity=effective_granularity,
            buckets=buckets,
        )

    @staticmethod
    async def get_workflow_performance(
        db: AsyncSession,
        organization_id: uuid.UUID,
        time_range: Optional[str] = "24h",
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        sort_by: str = "executions",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> WorkflowPerformanceResponse:
        """
        Retrieves paginated workflow-level performance and SLA compliance metrics.
        """
        start_dt, end_dt, _, _ = parse_and_validate_time_range(
            time_range=time_range,
            start_time=start_time,
            end_time=end_time,
        )

        page_size = min(max(page_size, 1), 100)
        page = max(page, 1)
        offset = (page - 1) * page_size

        wf_query = text("""
            WITH wf_stats AS (
                SELECT
                    w.id AS workflow_id,
                    w.name AS workflow_name,
                    w.status AS status,
                    w.active_version_id,
                    COUNT(r.id) AS total_executions,
                    COUNT(r.id) FILTER (WHERE r.status IN ('SUCCESS', 'COMPLETED')) AS success_count,
                    COUNT(r.id) FILTER (WHERE r.status = 'FAILED') AS failed_count,
                    COUNT(r.id) FILTER (WHERE r.status = 'CANCELLED') AS cancelled_count,
                    COUNT(r.id) FILTER (WHERE r.status IN ('RUNNING', 'PENDING', 'WAITING_APPROVAL', 'PAUSED')) AS in_flight_count,
                    COALESCE(AVG(
                        CASE 
                            WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                            THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                        END
                    ), 0.0) AS avg_duration_ms,
                    COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                        ORDER BY CASE 
                            WHEN r.completed_at IS NOT NULL AND r.started_at IS NOT NULL AND r.completed_at >= r.started_at AND r.status IN ('SUCCESS', 'COMPLETED', 'FAILED', 'CANCELLED')
                            THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000.0
                        END
                    ), 0.0) AS p95_duration_ms,
                    COUNT(r.id) FILTER (
                        WHERE (v.definition->'sla'->>'enabled')::boolean IS TRUE
                          AND (v.definition->'sla'->>'target_seconds') IS NOT NULL
                          AND (
                              CASE 
                                  WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                  ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                              END
                          ) <= (v.definition->'sla'->>'target_seconds')::double precision
                          AND NOT (r.status = 'CANCELLED' AND (
                              r.completed_at IS NULL OR 
                              EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) <= (v.definition->'sla'->>'warning_threshold_seconds')::double precision
                          ))
                    ) AS sla_compliant_count,
                    COUNT(r.id) FILTER (
                        WHERE (v.definition->'sla'->>'enabled')::boolean IS TRUE
                          AND (v.definition->'sla'->>'target_seconds') IS NOT NULL
                          AND (
                              CASE 
                                  WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                  ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                              END
                          ) > (v.definition->'sla'->>'target_seconds')::double precision
                    ) AS sla_breach_count,
                    COUNT(r.id) FILTER (
                        WHERE (v.definition->'sla'->>'enabled')::boolean IS TRUE
                          AND (v.definition->'sla'->>'target_seconds') IS NOT NULL
                          AND NOT (r.status = 'CANCELLED' AND (
                              r.completed_at IS NULL OR 
                              EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) <= (v.definition->'sla'->>'warning_threshold_seconds')::double precision
                          ))
                    ) AS sla_monitored_count
                FROM workflows w
                LEFT JOIN workflow_runs r ON w.id = r.workflow_id 
                    AND r.organization_id = :org_id 
                    AND r.started_at >= :start_dt 
                    AND r.started_at < :end_dt
                LEFT JOIN workflow_versions v ON r.workflow_version_id = v.id
                WHERE w.organization_id = :org_id
                GROUP BY w.id, w.name, w.status, w.active_version_id
            ),
            active_versions AS (
                SELECT id AS v_id, version_number, definition
                FROM workflow_versions
            )
            SELECT 
                s.*,
                av.version_number AS active_version_number,
                ((av.definition->'sla'->>'enabled')::boolean IS TRUE) AS has_sla
            FROM wf_stats s
            LEFT JOIN active_versions av ON s.active_version_id = av.v_id
        """)

        res = await db.execute(
            wf_query,
            {"org_id": organization_id, "start_dt": start_dt, "end_dt": end_dt},
        )
        rows = res.fetchall()

        items: List[WorkflowPerformanceItem] = []
        for r in rows:
            tot = int(r.total_executions or 0)
            s_cnt = int(r.success_count or 0)
            f_cnt = int(r.failed_count or 0)
            c_cnt = int(r.cancelled_count or 0)
            inf_cnt = int(r.in_flight_count or 0)
            term = s_cnt + f_cnt + c_cnt

            succ_rate = round(s_cnt / term * 100.0, 2) if term > 0 else 0.0
            fail_rate = round(f_cnt / term * 100.0, 2) if term > 0 else 0.0

            monitored = int(r.sla_monitored_count or 0)
            comp_cnt = int(r.sla_compliant_count or 0)
            sla_comp_rate = round(comp_cnt / monitored * 100.0, 2) if monitored > 0 else 0.0

            items.append(
                WorkflowPerformanceItem(
                    workflow_id=r.workflow_id,
                    workflow_name=r.workflow_name,
                    status=r.status,
                    active_version_number=r.active_version_number,
                    total_executions=tot,
                    success_count=s_cnt,
                    failed_count=f_cnt,
                    cancelled_count=c_cnt,
                    in_flight_count=inf_cnt,
                    success_rate=succ_rate,
                    failure_rate=fail_rate,
                    avg_duration_ms=round(float(r.avg_duration_ms or 0.0), 2),
                    p95_duration_ms=round(float(r.p95_duration_ms or 0.0), 2),
                    has_sla=bool(r.has_sla),
                    sla_compliance_rate=sla_comp_rate,
                    sla_breach_count=int(r.sla_breach_count or 0),
                )
            )

        reverse = (sort_order.lower() == "desc")
        if sort_by == "executions":
            items.sort(key=lambda x: x.total_executions, reverse=reverse)
        elif sort_by == "failure_rate":
            items.sort(key=lambda x: x.failure_rate, reverse=reverse)
        elif sort_by == "avg_duration":
            items.sort(key=lambda x: x.avg_duration_ms, reverse=reverse)
        elif sort_by == "breaches":
            items.sort(key=lambda x: x.sla_breach_count, reverse=reverse)
        else:
            items.sort(key=lambda x: x.total_executions, reverse=reverse)

        total_count = len(items)
        paginated_items = items[offset : offset + page_size]
        total_pages = math.ceil(total_count / page_size) if total_count > 0 else 1

        return WorkflowPerformanceResponse(
            items=paginated_items,
            total=total_count,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    @staticmethod
    async def get_step_latency(
        db: AsyncSession,
        organization_id: uuid.UUID,
        workflow_id: Optional[uuid.UUID] = None,
        time_range: Optional[str] = "24h",
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 20,
        sort_by: str = "avg_latency",
    ) -> StepLatencyResponse:
        """
        Calculates bounded step latency and failure metrics to identify bottlenecks.
        Enforces maximum limit of 100.
        """
        start_dt, end_dt, _, _ = parse_and_validate_time_range(
            time_range=time_range,
            start_time=start_time,
            end_time=end_time,
        )

        bounded_limit = min(max(limit, 1), 100)

        order_clause = "avg_execution_time_ms DESC"
        if sort_by == "p95_latency":
            order_clause = "p95_execution_time_ms DESC"
        elif sort_by == "failure_rate":
            order_clause = "failure_rate DESC"
        elif sort_by == "execution_count":
            order_clause = "total_executions DESC"

        params: Dict[str, Any] = {
            "org_id": organization_id,
            "start_dt": start_dt,
            "end_dt": end_dt,
            "limit": bounded_limit,
        }
        wf_clause_wr = ""
        if workflow_id is not None:
            wf_clause_wr = "AND wr.workflow_id = :wf_id"
            params["wf_id"] = workflow_id

        step_query = text(f"""
            SELECT 
                ws.step_key,
                ws.step_type,
                ws.name,
                COUNT(sr.id) AS total_executions,
                COUNT(sr.id) FILTER (WHERE sr.status = 'FAILED') AS failed_count,
                ROUND(COALESCE(COUNT(sr.id) FILTER (WHERE sr.status = 'FAILED')::double precision / NULLIF(COUNT(sr.id), 0) * 100.0, 0.0)::numeric, 2)::double precision AS failure_rate,
                ROUND(COALESCE(AVG(sr.execution_time_ms), 0.0)::numeric, 2)::double precision AS avg_execution_time_ms,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY sr.execution_time_ms), 0.0) AS p95_execution_time_ms,
                COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY sr.execution_time_ms), 0.0) AS p99_execution_time_ms
            FROM workflow_step_runs sr
            JOIN workflow_steps ws ON sr.step_id = ws.id
            JOIN workflow_runs wr ON sr.workflow_run_id = wr.id
            WHERE wr.organization_id = :org_id
              AND wr.started_at >= :start_dt
              AND wr.started_at < :end_dt
              {wf_clause_wr}
            GROUP BY ws.step_key, ws.step_type, ws.name
            ORDER BY {order_clause}
            LIMIT :limit
        """)

        res = await db.execute(step_query, params)
        rows = res.fetchall()

        items = [
            StepLatencyItem(
                step_key=r.step_key,
                step_type=r.step_type,
                name=r.name,
                total_executions=int(r.total_executions or 0),
                failed_count=int(r.failed_count or 0),
                failure_rate=float(r.failure_rate or 0.0),
                avg_execution_time_ms=float(r.avg_execution_time_ms or 0.0),
                p95_execution_time_ms=float(r.p95_execution_time_ms or 0.0),
                p99_execution_time_ms=float(r.p99_execution_time_ms or 0.0),
            )
            for r in rows
        ]

        return StepLatencyResponse(
            items=items,
            total=len(items),
            limit=bounded_limit,
            sort_by=sort_by,
        )

    @staticmethod
    async def get_sla_monitoring(
        db: AsyncSession,
        organization_id: uuid.UUID,
        workflow_id: Optional[uuid.UUID] = None,
        time_range: Optional[str] = "24h",
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> SLAMonitoringResponse:
        """
        Retrieves detailed SLA performance breakdown per workflow plus overall organization SLA summary.
        """
        start_dt, end_dt, resolved_range, _ = parse_and_validate_time_range(
            time_range=time_range,
            start_time=start_time,
            end_time=end_time,
        )

        overview = await AnalyticsService.get_overview(
            db=db,
            organization_id=organization_id,
            workflow_id=workflow_id,
            time_range=resolved_range,
            start_time=start_dt,
            end_time=end_dt,
        )

        params: Dict[str, Any] = {
            "org_id": organization_id,
            "start_dt": start_dt,
            "end_dt": end_dt,
        }
        wf_clause_r = ""
        wf_clause_w = ""
        if workflow_id is not None:
            wf_clause_r = "AND r.workflow_id = :wf_id"
            wf_clause_w = "AND w.id = :wf_id"
            params["wf_id"] = workflow_id

        wf_sla_query = text(f"""
            WITH runs_eval AS (
                SELECT 
                    r.workflow_id,
                    r.status,
                    r.started_at,
                    r.completed_at,
                    (v.definition->'sla'->>'enabled')::boolean AS sla_enabled,
                    (v.definition->'sla'->>'target_seconds')::double precision AS target_sec,
                    (v.definition->'sla'->>'warning_threshold_seconds')::double precision AS warn_sec,
                    CASE
                        WHEN (v.definition->'sla'->>'enabled')::boolean IS NOT TRUE THEN 'NOT_APPLICABLE'
                        WHEN (v.definition->'sla'->>'target_seconds') IS NULL THEN 'NOT_APPLICABLE'
                        WHEN r.status = 'CANCELLED' AND (
                            r.completed_at IS NULL OR 
                            EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) <= (v.definition->'sla'->>'warning_threshold_seconds')::double precision
                        ) THEN 'NOT_APPLICABLE'
                        WHEN (
                            CASE 
                                WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                            END
                        ) > (v.definition->'sla'->>'target_seconds')::double precision THEN 'BREACHED'
                        WHEN (
                            CASE 
                                WHEN r.completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.completed_at - r.started_at))
                                ELSE EXTRACT(EPOCH FROM (NOW() - r.started_at))
                            END
                        ) > (v.definition->'sla'->>'warning_threshold_seconds')::double precision THEN 'WARNING'
                        ELSE 'HEALTHY'
                    END AS sla_status
                FROM workflow_runs r
                JOIN workflow_versions v ON r.workflow_version_id = v.id
                WHERE r.organization_id = :org_id
                  AND r.started_at >= :start_dt
                  AND r.started_at < :end_dt
                  {wf_clause_r}
            ),
            active_info AS (
                SELECT 
                    w.id AS workflow_id,
                    w.name AS workflow_name,
                    v.version_number,
                    (v.definition->'sla'->>'enabled')::boolean AS active_sla_enabled,
                    (v.definition->'sla'->>'target_seconds')::double precision AS active_target_sec,
                    (v.definition->'sla'->>'warning_threshold_seconds')::double precision AS active_warn_sec
                FROM workflows w
                LEFT JOIN workflow_versions v ON w.active_version_id = v.id
                WHERE w.organization_id = :org_id
                  {wf_clause_w}
            )
            SELECT 
                ai.workflow_id,
                ai.workflow_name,
                ai.version_number AS active_version_number,
                COALESCE(ai.active_sla_enabled, false) AS sla_enabled,
                ai.active_target_sec AS target_seconds,
                ai.active_warn_sec AS warning_threshold_seconds,
                COUNT(re.sla_status) FILTER (WHERE re.sla_status IN ('HEALTHY', 'WARNING', 'BREACHED')) AS total_evaluated,
                COUNT(re.sla_status) FILTER (WHERE re.sla_status = 'HEALTHY') AS healthy_count,
                COUNT(re.sla_status) FILTER (WHERE re.sla_status = 'WARNING') AS warning_count,
                COUNT(re.sla_status) FILTER (WHERE re.sla_status = 'BREACHED') AS breached_count,
                COUNT(re.sla_status) FILTER (
                    WHERE re.status IN ('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED')
                      AND re.sla_status = 'BREACHED'
                ) AS current_active_breaches
            FROM active_info ai
            LEFT JOIN runs_eval re ON ai.workflow_id = re.workflow_id
            GROUP BY 
                ai.workflow_id,
                ai.workflow_name,
                ai.version_number,
                ai.active_sla_enabled,
                ai.active_target_sec,
                ai.active_warn_sec
            ORDER BY ai.workflow_name ASC
        """)

        res = await db.execute(wf_sla_query, params)
        rows = res.fetchall()

        workflows: List[SLAMonitoringItem] = []
        for r in rows:
            monitored = int(r.total_evaluated or 0)
            h = int(r.healthy_count or 0)
            w = int(r.warning_count or 0)
            b = int(r.breached_count or 0)
            act_breaches = int(r.current_active_breaches or 0)

            c_rate = round((h + w) / monitored * 100.0, 2) if monitored > 0 else 0.0
            h_rate = round(h / monitored * 100.0, 2) if monitored > 0 else 0.0
            b_rate = round(b / monitored * 100.0, 2) if monitored > 0 else 0.0

            workflows.append(
                SLAMonitoringItem(
                    workflow_id=r.workflow_id,
                    workflow_name=r.workflow_name,
                    active_version_number=r.active_version_number,
                    sla_enabled=bool(r.sla_enabled),
                    target_seconds=r.target_seconds,
                    warning_threshold_seconds=r.warning_threshold_seconds,
                    total_evaluated=monitored,
                    healthy_count=h,
                    warning_count=w,
                    breached_count=b,
                    compliance_rate=c_rate,
                    healthy_rate=h_rate,
                    breach_rate=b_rate,
                    current_active_breaches=act_breaches,
                )
            )

        return SLAMonitoringResponse(
            summary=overview.sla,
            workflows=workflows,
        )
