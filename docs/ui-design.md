# FlowPilot: UI/UX Design Specification

| Metadata | Specification |
|---|---|
| **Document Version** | 1.0.0 |
| **Status** | Approved for MVP (Phase 1) |
| **Frontend Framework** | React 19 + TypeScript + Vite |
| **Styling & Canvas** | Tailwind CSS + Lucide Icons + React Flow (@xyflow/react) |

---

## 1. Design Philosophy & Aesthetic Principles

1. **Enterprise Clarity & High Information Density**: Clean layout, purposeful white space, and visual hierarchy optimized for operational workflows.
2. **Deterministic Feedback & Zero Mystery**: Every operation, save action, and async background trigger provides clear loading, success, or actionable error feedback.
3. **Responsive & Accessible**: WCAG 2.1 AA compliant color contrasts, semantic HTML elements, keyboard-navigable dialogs, and adaptive responsive layouts.
4. **No Placeholders or Generic Clutter**: Dedicated empty states with contextual guidance and direct actions ("Create your first workflow", "No pending approvals").

---

## 2. Design Tokens & Visual Hierarchy

### 2.1 Color Palette
- **Neutrals (Background & Text)**:
  - Canvas Background: Slate 50 (`#f8fafc`) / Dark mode: Slate 950 (`#020617`)
  - Card & Surface: White (`#ffffff`) / Dark mode: Slate 900 (`#0f172a`)
  - Border: Slate 200 (`#e2e8f0`) / Dark mode: Slate 800 (`#1e293b`)
  - Body Text: Slate 700 (`#334155`) / Slate 300 (`#cbd5e1`)
  - Heading Text: Slate 900 (`#0f172a`) / Slate 50 (`#f8fafc`)
- **Primary Brand Accent**: Indigo 600 (`#4f46e5`) -> Hover: Indigo 700 (`#4338ca`)
- **Semantic Colors**:
  - Success / Active: Emerald 600 (`#059669`) / Badge bg: Emerald 50
  - Warning / Approval Pending: Amber 500 (`#d97706`) / Badge bg: Amber 50
  - Danger / Failed: Rose 600 (`#e11d48`) / Badge bg: Rose 50
  - Informational: Sky 600 (`#0284c7`) / Badge bg: Sky 50

### 2.2 Typography
- **Primary Font**: `Inter, system-ui, -apple-system, sans-serif`
- **Monospace Font**: `JetBrains Mono, Menlo, monospace` (used for IDs, JSON viewers, webhook URLs)

---

## 3. Global Application Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ Top Bar: [FlowPilot Logo] | [Org Switcher ▾] | [System Status 🟢] | [User Menu ▾]│
├──────────────┬─────────────────────────────────────────────────────────┤
│ Sidebar:     │ Breadcrumbs / Page Header                               │
│              ├─────────────────────────────────────────────────────────┤
│ 📊 Dashboard  │                                                         │
│ ⚡ Workflows  │                                                         │
│ 🔌 Integrate │ Main Content Area                                       │
│ 📜 Executions│ (Responsive Viewport: Cards, Tables, Canvas, Timelines)  │
│ 🛡️ Approvals │                                                         │
│ 📈 Analytics │                                                         │
│ 👥 Team      │                                                         │
│ ⚙️ Settings   │                                                         │
└──────────────┴─────────────────────────────────────────────────────────┘
```

---

## 4. Screen-by-Screen Specifications

### 4.1 Dashboard
- **Top Metric Cards**:
  - Total Workflows (Active vs Paused breakdown)
  - 24h Executions Count with percentage trend
  - Success Rate (e.g. 99.4%) with micro donut indicator
  - Pending Approvals requiring immediate review
- **Recent Executions Table**: Real-time list showing Run ID, Workflow Name, Trigger Source, Status badge, Duration, and relative timestamp.
- **Quick Action**: "Create New Workflow" button launching the creation modal.

### 4.2 Workflows Management
- **Search & Filters**: Instant search by workflow name, filter by status (`ACTIVE`, `DRAFT`, `PAUSED`, `ARCHIVED`).
- **Workflow Cards / Table**:
  - Title, description, status pill, active version badge.
  - Webhook URL copy-to-clipboard button.
  - Action dropdown: Edit Canvas, Duplicate, Pause/Resume, Archive, Delete.

### 4.3 Visual Workflow Builder (React Flow)
- **Interactive Canvas**:
  - Pan, zoom, minimap, background grid dots.
  - Custom React Flow Node Cards with status indicators and category icons:
    - `Webhook Trigger` (Cyan)
    - `Data Validation` (Blue)
    - `AI Classification` (Purple)
    - `Condition / Rule` (Amber)
    - `Mock CRM Action` (Emerald)
    - `Slack Notification` (Indigo)
    - `Human Approval` (Rose)
- **Node Configuration Drawer**: Clicking a node slides out a configuration panel with input validation (e.g., Slack channel picker, AI prompt settings, Rule comparison builder).
- **Top Control Bar**:
  - Workflow Name & Status badge
  - "Validate Workflow" button (checks DAG cycles and required connections)
  - "Save Draft" & "Publish Workflow" buttons
  - "Test Run" modal to send simulated webhook payload.

### 4.4 Executions & Step Timeline
- **Execution Overview**: High-level status banner (`SUCCESS`, `FAILED`, `WAITING_FOR_APPROVAL`), total duration, correlation ID.
- **Interactive Step Timeline**: Vertical step card sequence displaying:
  - Step icon, title, and individual duration (ms)
  - Expandable JSON Viewer for step input and output data
  - Highlighted error stack trace if a step failed
  - "Retry Run" button with option to retry from failure point.

### 4.5 Approvals Inbox
- **Filter Tabs**: `Pending Review` (with notification badge count), `Approved`, `Rejected`.
- **Approval Cards**:
  - Contextual lead details (Name, Company, Employee Count, AI Priority, Confidence score).
  - Reason for approval requirement (e.g. "Enterprise tier account with 450 employees").
  - Action controls: "Approve" (Emerald) and "Reject" (Rose) buttons with mandatory comment field.

### 4.6 Integrations Hub
- **Integration Cards**:
  - Mock CRM (Connected / Active)
  - Slack (Connected / OAuth token configured)
  - Custom Webhook Ingestion (Active)
- **Configuration Modal**: Secure credential entry dialog with "Test Connection" button providing instant roundtrip ping results.

### 4.7 Analytics Dashboard
- **Charts (Recharts)**:
  - 14-day execution volume line chart (Successful vs Failed)
  - AI classification distribution bar chart (Enterprise vs Mid-market vs SMB)
  - Average step execution latency breakdown
  - Estimated Human Hours Saved ROI metric card.

### 4.8 Organization & Team Settings
- **Organization Details**: Edit organization name, slug, view tenant UUID.
- **Team Members Table**: List members, invite new users via email, assign RBAC roles (`ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`), remove member dialog.
